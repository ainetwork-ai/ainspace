'use client';

import { useState, useRef, useEffect, useCallback, forwardRef } from 'react';
import { cn } from '@/lib/utils';
import Image from 'next/image';
import { ChatMessage, Thread, useAgentStore, useBuildStore, useChatStore, useGameStateStore, useThreadStore, useUIStore, useUserAgentStore, useUserStore } from '@/stores';
import * as Sentry from '@sentry/nextjs';
import { useThreadStream } from '@/hooks/useThreadStream';
import { StreamEvent } from '@/lib/a2aOrchestration';
import { AlertTriangle, Triangle, X } from 'lucide-react';
import ChatMessageCard from '@/components/chat/ChatMessageCard';
import { AgentState } from '@/lib/agent';
import MentionSuggestionDropdown from '@/components/chat/MentionSuggestionDropdown';
import { bffAuthFetch } from '@/lib/backend/bff-fetch';
import { Spinner } from '@/components/ui/spinner';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useNearbyAgents } from '@/hooks/useNearbyAgents';
import { buildIngestPayload, IngestAgentInput } from '@/lib/report/build-ingest-payload';
import { dualWriteTurn } from '@/lib/report/dual-write';

// When a thread's history is refetched on open, the backend result is the shared
// source of truth — but it does NOT yet include a just-sent optimistic user
// message that is still in-flight (not persisted). Overwriting the store wholesale
// wipes that message from the UI while the reply is awaited (the bug seen when
// chatting an existing agent-combo without first selecting its thread). Preserve
// store messages absent from the fetched history, matched by id AND by sender+text
// so the optimistic copy is dropped once the backend has persisted an equivalent
// (otherwise it would resurface as a duplicate on the next reopen).
export function mergePendingMessages(
    fetched: ChatMessage[],
    prev: ChatMessage[] | undefined
): ChatMessage[] {
    if (!prev || prev.length === 0) return fetched;
    const fetchedIds = new Set(fetched.map((m) => m.id));
    const fetchedContentKeys = new Set(fetched.map((m) => `${m.sender}|${m.text}`));
    const pending = prev.filter(
        (m) => !fetchedIds.has(m.id) && !fetchedContentKeys.has(`${m.sender}|${m.text}`)
    );
    return pending.length > 0 ? [...fetched, ...pending] : fetched;
}

// --- EPIC21 report dual-write glue -------------------------------------------
// Resolve a thread's agent roster (name + a2aUrl + backendAgentId) for the ingest
// payload. Store reads go through getState() so this stays off React's render path
// — dual-write is fire-and-forget and must never affect chat state.

// New-thread send: agents are the in-radius AgentState list (carries agentUrl =
// a2aUrl and, once EPIC16 sync ran, backendUuid).
function rosterFromNearby(nearby: AgentState[]): IngestAgentInput[] {
    return nearby
        .filter((a) => a.name)
        .map((a) => {
            const entry: IngestAgentInput = { name: a.name };
            if (a.agentUrl) entry.a2aUrl = a.agentUrl;
            if (a.backendUuid) entry.backendAgentId = a.backendUuid;
            if (a.color) entry.color = a.color;
            return entry;
        });
}

// Existing-thread send: the Thread only holds agent names, so resolve a2aUrl /
// backendAgentId from the local agent stores (world store first, then the persisted
// StoredAgent store by card name).
function rosterFromNames(names: string[]): IngestAgentInput[] {
    const world = useAgentStore.getState().agents;
    const stored = useUserAgentStore.getState().agents;
    return names.map((name) => {
        const entry: IngestAgentInput = { name };
        const w = world.find((a) => a.name === name);
        if (w) {
            if (w.agentUrl) entry.a2aUrl = w.agentUrl;
            if (w.backendUuid) entry.backendAgentId = w.backendUuid;
            if (w.color) entry.color = w.color;
            return entry;
        }
        const s = stored.find((a) => a.card?.name === name);
        if (s) {
            if (s.url) entry.a2aUrl = s.url;
            if (s.backendUuid) entry.backendAgentId = s.backendUuid;
        }
        return entry;
    });
}

// Agent SSE turn: resolve the speaker's a2aUrl. Prefer the backend user UUID (the
// SSE delivers it reliably as messageData.userId), then fall back to display-name
// match (the backend may suffix the name, so UUID is the sturdier key). undefined
// => caller omits senderA2aUrl best-effort (never fails the turn).
function resolveTurnA2aUrl(backendAgentId: string | undefined, speaker: string): string | undefined {
    const world = useAgentStore.getState().agents;
    const stored = useUserAgentStore.getState().agents;
    if (backendAgentId) {
        const w = world.find((a) => a.backendUuid === backendAgentId);
        if (w?.agentUrl) return w.agentUrl;
        const s = stored.find((a) => a.backendUuid === backendAgentId);
        if (s?.url) return s.url;
    }
    const wn = world.find((a) => a.name === speaker);
    if (wn?.agentUrl) return wn.agentUrl;
    const sn = stored.find((a) => a.card?.name === speaker);
    if (sn?.url) return sn.url;
    return undefined;
}

interface ChatBoxProps {
    className?: string;
    onAddMessage?: (message: ChatMessage) => void;
    openThreadList: () => void;
    aiCommentary?: string;
    onThreadSelect?: (threadId: string | undefined) => void;
    onResetLocation?: () => void;
    onLoadingChange?: (loading: boolean) => void;
}

export interface ChatBoxRef { 
    sendMessage: (message: string, threadId?: string, broadcastRadius?: number) => Promise<void>;
}

const ChatBox = forwardRef<ChatBoxRef, ChatBoxProps>(function ChatBox(
    { className = '', aiCommentary, onResetLocation, openThreadList, onLoadingChange },
    ref
) {
    const { messages, setMessages, getMessagesByThreadId } = useChatStore();
    const { currentThreadId, setCurrentThreadId, findThreadByName, findThreadById, addThread } = useThreadStore();
    const nearbyAgents = useNearbyAgents();
    const [inputValue, setInputValue] = useState('');
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [filteredAgents, setFilteredAgents] = useState<AgentState[]>([]);
    const [cursorPosition, setCursorPosition] = useState(0);
    const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
    const [isMessageLoading, setIsMessageLoading] = useState(false);
    // EPIC19: set when SSE auth recovery is exhausted. Thrown during render so a
    // (local) error boundary catches it — replaces the old "Error: ..." system bubble.
    const [fatalStreamError, setFatalStreamError] = useState<Error | null>(null);
    const { setShowCollisionMap } = useBuildStore();
    const inputRef = useRef<HTMLInputElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const responseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const sseConnectedResolverRef = useRef<(() => void) | null>(null);
    // EPIC21 (F5, privacy-critical): the SSE stream also delivers agent replies that
    // OTHER clients (ainteams) triggered against a shared DM. Dual-write only the
    // turns ainspace itself conducted — so agent-turn dual-write is gated to the
    // send ainspace just performed: the thread it sent to, while that round is still
    // in progress. Set on send, cleared when the round's loading ends.
    const conductedSendRef = useRef<{ threadId: string | null; inProgress: boolean }>({
        threadId: null,
        inProgress: false,
    });

    const [displayedMessages, setDisplayedMessages] = useState<ChatMessage[]>([]);
    const activeThread = currentThreadId && currentThreadId !== '0' ? findThreadById(currentThreadId) : undefined;
    const unplacedAgentNames = activeThread?.unplacedAgentNames ?? [];
    const hasUnplacedAgents = !!(
        activeThread?.hasUnplacedAgents ||
        (unplacedAgentNames && unplacedAgentNames.length > 0)
    );

    // Track if a message has been sent (to enable SSE connection)

    const userId = useUserStore((state) => state.getUserId());
    const isBackendAuthed = useUserStore((state) => state.isBackendAuthed);
    const isKioskSession = useUserStore((state) => state.isKioskSession);
    const { updateThread } = useThreadStore();
    const { isDesktop } = useIsDesktop();

    // Cleanup timeout refs on unmount
    useEffect(() => {
        return () => {
            if (responseTimeoutRef.current) {
                clearTimeout(responseTimeoutRef.current);
            }
            sseConnectedResolverRef.current = null;
        };
    }, []);

    // Notify parent when loading state changes
    useEffect(() => {
        onLoadingChange?.(isMessageLoading);
    }, [isMessageLoading, onLoadingChange]);

    // EPIC21: a round ends when loading flips off (reply complete / timeout / error
    // all route through setIsMessageLoading(false)). Once it does, stop attributing
    // further agent turns in this thread to ainspace — subsequent replies would be
    // ainteams-triggered. This single effect is the catch-all for every end path.
    useEffect(() => {
        if (!isMessageLoading) conductedSendRef.current.inProgress = false;
    }, [isMessageLoading]);

    // FIXME(yoojin): move type
    interface BackendMessage {
        id: string;
        replyTo?: string;
        content: string;
        speaker: string;
        avatarUrl?: string | null;
        senderUserId?: string | null;
        timestamp: Date;
    }

    const mappingBackendMessagesToChatMessages = useCallback(
        (backendMessages: BackendMessage[], threadId: string) => {
            return backendMessages.map((backendMessage) => {
                const isUserMessage = backendMessage.speaker === 'User';
                return {
                    id: backendMessage.id,
                    text: backendMessage.content,
                    timestamp: backendMessage.timestamp,
                    sender: isUserMessage ? 'user' : 'ai',
                    senderId: isUserMessage ? userId : backendMessage.speaker,
                    avatarUrl: backendMessage.avatarUrl ?? undefined,
                    senderUserId: backendMessage.senderUserId ?? undefined,
                    threadId: threadId
                } as ChatMessage;
            });
        },
        [userId]
    );

    // EPIC18 kiosk invariant: this reads conversation content from the shared
    // kiosk account and is NOT guarded. The skip-fetch kiosk design holds only
    // because kiosk thread ids originate solely from in-session addThread and
    // Ctrl+K resets currentThreadId to '0'. Never set currentThreadId on a kiosk
    // to a backend id not in the local thread list (e.g. deep links / notifications)
    // or it would load a prior visitor's messages.
    const fetchThreadMessages = useCallback(
        async (threadId: string) => {
            const response = await bffAuthFetch(`/api/threads/${threadId}`);
            const data = await response.json();

            if (data.success && data.messages) {
                const mappedMessages = mappingBackendMessagesToChatMessages(data.messages, threadId) as ChatMessage[];
                return mappedMessages;
            }
            return [];
        },
        [mappingBackendMessagesToChatMessages]
    );

    useEffect(() => {
        if (currentThreadId && currentThreadId !== '0') {
            // Always refetch from the backend on open. The DM is a shared source of
            // truth (e.g. ainteams may have added messages since this thread was
            // last cached), so the in-memory cache alone goes stale — and SSE only
            // delivers messages that arrive *after* opening, not past history.
            // Cached messages are shown immediately by the sync effect below; we
            // skip an empty result and merge (not overwrite) a non-empty one so a
            // just-sent optimistic message isn't wiped before its send is persisted.
            fetchThreadMessages(currentThreadId).then((fetched) => {
                if (fetched.length > 0) {
                    // Merge rather than overwrite: a just-sent optimistic user
                    // message isn't in the backend history yet, so a wholesale
                    // replace would drop it from the UI while the reply streams in.
                    setMessages((prev) => mergePendingMessages(fetched, prev), currentThreadId);
                }
            });
        } else {
            setDisplayedMessages([]);
        }
    }, [currentThreadId, setMessages, fetchThreadMessages]);

    useEffect(() => {
        if (currentThreadId && currentThreadId !== '0') {
            const filteredMessages = getMessagesByThreadId(currentThreadId);
            setDisplayedMessages(filteredMessages);
        }
    }, [messages, currentThreadId, getMessagesByThreadId]);

    // Generate thread name from agent names (supports korean)
    const generateThreadName = useCallback((agentNames: string[]): string => {
        if (agentNames.length === 0) return '';
        // Sort names for consistency
        const sortedNames = [...agentNames].sort();
        const agentString = sortedNames.join(', ').replace(/[^a-z0-9가-힣\s,]/gi, '');
        return agentString;
    }, []);

    // Handle SSE stream messages from the backend orchestration stream
    const handleStreamEvent = useCallback(
        (event: StreamEvent) => {
            if (event.type === 'connected') {
                console.log('Connected to thread stream');
                if (sseConnectedResolverRef.current) {
                    sseConnectedResolverRef.current();
                    sseConnectedResolverRef.current = null;
                }
                return;
            }

            if (event.type === 'message') {
                // Clear response timeout on first AI message
                if (responseTimeoutRef.current) {
                    clearTimeout(responseTimeoutRef.current);
                    responseTimeoutRef.current = null;
                }
                // Backend SSE message event (EPIC14): payload is
                //   { type:'message', data:{ id, conversationId, speaker, userId, content, parentId?, createdAt } }
                // so speaker/content/id live directly on event.data.
                const messageData = event.data as {
                    id?: string;
                    speaker?: string;
                    content?: string;
                    userId?: string;
                };

                const messageContent = messageData.content ?? '';
                if (!messageContent) {
                    // Nothing renderable (malformed/empty payload) — skip rather than
                    // dumping the raw event object into a chat bubble.
                    return;
                }
                const agentName = messageData.speaker || 'agent';

                // Add agent message to chat
                const agentMessage: ChatMessage = {
                    id: messageData.id || `stream-${Date.now()}-${Math.random()}`,
                    text: messageContent,
                    timestamp: new Date(),
                    sender: 'ai',
                    senderId: agentName,
                    senderUserId: messageData.userId,
                    threadId: currentThreadId || undefined
                };
                setMessages((prev) => {
                    if (!prev) return [agentMessage];
                    return [...prev, agentMessage];
                }, currentThreadId);

                // EPIC21: best-effort dual-write of THIS agent turn — gated (F5) to a
                // send ainspace itself conducted in this same thread, so ainteams-
                // triggered replies flowing through the same stream are NOT mirrored.
                // Fire-and-forget: never awaited, never throws (chat UX untouched).
                try {
                    const gate = conductedSendRef.current;
                    if (gate.inProgress && gate.threadId && gate.threadId === currentThreadId) {
                        const backendUser = useUserStore.getState().backendUser;
                        if (backendUser && currentThreadId) {
                            const thread = useThreadStore.getState().findThreadById(currentThreadId);
                            const senderA2aUrl = resolveTurnA2aUrl(messageData.userId, agentName);
                            // Register the speaking agent by its SSE display name (the
                            // same source as the turn's speaker) so the orchestrator's
                            // join key matches; messageData.userId is the reliable
                            // backendAgentId (SSE-delivered, may backfill an un-synced agent).
                            const speakerAgent: IngestAgentInput = { name: agentName };
                            if (senderA2aUrl) speakerAgent.a2aUrl = senderA2aUrl;
                            if (messageData.userId) speakerAgent.backendAgentId = messageData.userId;
                            dualWriteTurn(
                                buildIngestPayload({
                                    conversationId: currentThreadId,
                                    threadName: thread?.threadName,
                                    user: { backendUserId: backendUser.id },
                                    agents: [speakerAgent],
                                    turns: [
                                        {
                                            kind: 'agent',
                                            id: agentMessage.id,
                                            speaker: agentName,
                                            content: messageContent,
                                            timestamp: agentMessage.timestamp.getTime(),
                                            senderA2aUrl,
                                        },
                                    ],
                                })
                            );
                        }
                    }
                } catch {
                    // Best-effort: dual-write must never affect chat rendering.
                }
            } else if (event.type === 'block') {
                // Block messages are not displayed in chat (used for internal processing only)
                console.log('Block event (not displayed):', event.data);
                if (event.data.next?.id === 'user') {
                    if (responseTimeoutRef.current) {
                        clearTimeout(responseTimeoutRef.current);
                        responseTimeoutRef.current = null;
                    }
                    setIsMessageLoading(false);
                } else if (event.data.next?.id) {
                    // Next agent in chain — reset timeout for the next agent's response
                    if (responseTimeoutRef.current) clearTimeout(responseTimeoutRef.current);
                    responseTimeoutRef.current = setTimeout(() => {
                        setIsMessageLoading((loading) => {
                            if (!loading) return false;
                            const timeoutMessage: ChatMessage = {
                                id: `timeout-${Date.now()}`,
                                text: `No response from ${event.data.next?.name || 'agent'}. Please try again.`,
                                timestamp: new Date(),
                                sender: 'system',
                                threadId: currentThreadId || undefined
                            };
                            setMessages((prev) => [...prev, timeoutMessage], currentThreadId);
                            setDisplayedMessages((prev) => [...prev, timeoutMessage]);
                            return false;
                        });
                        responseTimeoutRef.current = null;
                    }, 60000);
                }
            } else if (event.type === 'error') {
                // EPIC19: 401 auth errors are intercepted upstream (useThreadStream);
                // this branch only handles non-auth stream errors. The proxy emits
                // { status, body }, not { error } — fall back across all shapes.
                const errData = event.data as { error?: string; body?: string; status?: number } | undefined;
                const detail = errData?.error ?? errData?.body
                    ?? (errData?.status ? `status ${errData.status}` : 'Unknown error');
                const errorMessage: ChatMessage = {
                    id: `error-${Date.now()}`,
                    text: `Error: ${detail}`,
                    timestamp: new Date(),
                    sender: 'system',
                    threadId: currentThreadId || undefined
                };
                setMessages([errorMessage], currentThreadId);
            }
        },
        [currentThreadId, setMessages]
    );

    useThreadStream({
        threadId: currentThreadId && currentThreadId !== '0' ? currentThreadId : null,
        onMessage: handleStreamEvent,
        // EPIC19: SSE auth recovery exhausted -> throw via render (caught by the
        // local ChatStreamErrorBoundary) instead of a system-message-first bubble.
        onFatal: setFatalStreamError,
        // Subscribe whenever a real thread is open (not only after sending), so
        // agent/orchestration activity in the active thread streams in live —
        // e.g. replies to messages triggered from another client (ainteams).
        enabled: !!currentThreadId && currentThreadId !== '0'
    });

    const moveToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        moveToBottom();
    }, [displayedMessages]);

    // Add AI commentary to messages when it changes
    useEffect(() => {
        if (aiCommentary && aiCommentary.trim()) {
            const aiMessage: ChatMessage = {
                id: `ai-${Date.now()}`,
                text: aiCommentary,
                timestamp: new Date(),
                sender: 'ai',
                senderId: undefined,
                threadId: undefined // AI commentary is not part of any thread
            };

            setMessages((prev) => {
                // Check if the last message is the same AI commentary to avoid duplicates
                const lastMessage = prev[prev.length - 1];
                if (lastMessage && lastMessage.sender === 'ai' && lastMessage.text === aiCommentary) {
                    return prev;
                }
                return [...prev, aiMessage]; // FIXME(yoojin): use currentThreadId
            }, currentThreadId);
        }
    }, [aiCommentary, currentThreadId]);

    const handleSendMessage = async () => {
        // EPIC14: sending requires a backend session (token), not just a
        // connected wallet/guest sessionId — the message path proxies the
        // browser-held Bearer to the backend DM. A non-logged-in user can't send;
        // prompt the wallet-connect modal instead of failing silently.
        if (!isBackendAuthed || !userId) {
            useUIStore.getState().setWalletModalOpen(true);
            return;
        }

        if (inputValue.trim() === 'show me grid') {
            setShowCollisionMap(true);
            setInputValue('');
        } else if (inputValue.trim() === 'exit') {
            setShowCollisionMap(false);
            setInputValue('');
        } else if (inputValue.trim() === 'clear items') {
            setInputValue('');
            const systemMessage: ChatMessage = {
                id: `system-${Date.now()}`,
                text: 'Clearing all placed items...',
                timestamp: new Date(),
                sender: 'system',
                threadId: undefined
            };
            setMessages([systemMessage], currentThreadId);

            try {
                // Call the clear-layer1 API endpoint
                const response = await fetch('/api/clear-layer1');

                if (!response.ok) {
                    throw new Error('Failed to clear items from database');
                }

                const data = await response.json();

                // Update local state from useBuildStore
                const { setCustomTiles, setPublishedTiles, updateCollisionMapFromImage } = useBuildStore.getState();

                // Clear customTiles.layer1 and publishedTiles.layer1
                setCustomTiles((prev) => ({
                    ...prev,
                    layer1: {}
                })); 

                setPublishedTiles((prev) => ({
                    ...prev,
                    layer1: {}
                }));

                // Reset collision map to base land_layer_1.webp only
                await updateCollisionMapFromImage('/map/land_layer_1.webp');

                const successMessage: ChatMessage = {
                    id: `system-${Date.now()}`,
                    text: `All items have been cleared! Deleted ${data.deletedCount} tiles. All 6 items are now available for placement again.`,
                    timestamp: new Date(),
                    sender: 'system',
                    threadId: undefined
                };
                setMessages([successMessage], currentThreadId);
            } catch (error) {
                const errorMessage: ChatMessage = {
                    id: `system-${Date.now()}`,
                    text: `Failed to clear items: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    timestamp: new Date(),
                    sender: 'system',
                    threadId: undefined
                };
                setMessages([errorMessage], currentThreadId);
            }
        } else if (inputValue.trim()) {
            const isCurrentThreadSelected = currentThreadId && currentThreadId !== '0';
            const selectedThread = isCurrentThreadSelected ? findThreadById(currentThreadId) : undefined;

            // Block send when no thread is selected and no nearby agents
            if (!selectedThread && nearbyAgents.length === 0) return;

            const userMessageText = inputValue.trim();
            setInputValue('');
            setIsMessageLoading(true);

            const agentNames: string[] = [];
            let threadIdToSend: string | undefined = undefined;
            let threadName = '';

            const newMessage: ChatMessage = {
                id: Date.now().toString(),
                text: userMessageText,
                timestamp: new Date(),
                sender: 'user',
                senderId: userId,
                threadId: threadIdToSend
            };

            setDisplayedMessages((prev) => {
                if (!prev) return [newMessage];
                return [...prev, newMessage];
            });

            if (selectedThread) {
                agentNames.push(...selectedThread.agentNames);
                threadName = selectedThread.threadName;
                threadIdToSend = selectedThread.id;
            } else {
                nearbyAgents.forEach((a: AgentState) => {
                    agentNames.push(a.name);
                });
                threadName = generateThreadName(agentNames);
                const existingThread = findThreadByName(threadName);
                console.log(threadName, existingThread?.threadName);

                if (existingThread) {
                    console.log('Agent combination changed - switching to thread:', existingThread.threadName);
                    const existingThreadMessages = await fetchThreadMessages(existingThread.id);
                    setMessages(existingThreadMessages, existingThread.id);
                    setDisplayedMessages(existingThreadMessages);
                    setCurrentThreadId(existingThread.id);
                    threadIdToSend = existingThread.id;
                }
            }

            console.log('HandleSendMessage:', {
                text: newMessage.text,
                threadName: threadName,
                threadId: threadIdToSend,
                messageId: newMessage.id,
                agentsInRadius: agentNames,
                isNewThread: !isCurrentThreadSelected,
                previousThreadId: currentThreadId
            });

            let newDPMessages: ChatMessage[] = [];
            setMessages((prev) => {
                newDPMessages = [...(prev || []), newMessage];
                return newDPMessages;
            }, threadIdToSend);

            try {
                // Step 1: For new threads, create thread first and wait for SSE
                const isNewThread = !threadIdToSend;
                if (isNewThread) {
                    // EPIC15: create (or reuse) the backend DM. The server owns
                    // the thread id; agent a2aUrls are resolved to backend user
                    // UUIDs inside the BFF, which returns the assembled Thread.
                    const agentUrls = nearbyAgents.map((a: AgentState) => a.agentUrl);
                    // EPIC18: kiosk shares one backend account, so a plain create
                    // would dedupe onto a prior visitor's conversation. The kiosk
                    // thread list is local-only, so reaching this isNewThread path
                    // means "first time this agent-combo this session" -> always
                    // forceNew a fresh conversation. Within-session re-chats hit the
                    // local thread (findThreadByName) and never reach here. Wallet
                    // sessions (isKioskSession=false) keep backend dedup unchanged.
                    const useForceNew = isKioskSession;
                    const createResponse = await bffAuthFetch('/api/threads', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ agentUrls, ...(useForceNew ? { forceNew: true } : {}) }),
                    });
                    if (createResponse.status === 422) {
                        throw new Error('NO_RESOLVABLE_AGENTS');
                    }
                    const createResult = await createResponse.json();
                    if (!createResponse.ok) {
                        throw new Error(createResult.details || createResult.error || createResponse.statusText);
                    }

                    const createdThread = createResult.thread as Thread;
                    threadIdToSend = createdThread.id;
                    addThread(createdThread);

                    setMessages((prev) => {
                        if (!prev) return [newMessage];
                        return [...prev, newMessage];
                    }, threadIdToSend!);
                    setMessages([], '0');

                    setCurrentThreadId(threadIdToSend!);

                    // SSE connects on the currentThreadId change above; wait for
                    // its synthetic 'connected' before sending (max 10s timeout)
                    let sseTimeoutId: ReturnType<typeof setTimeout> | null = null;
                    await Promise.race([
                        new Promise<void>((resolve) => { sseConnectedResolverRef.current = resolve; }),
                        new Promise<void>((_, reject) => {
                            sseTimeoutId = setTimeout(() => {
                                sseConnectedResolverRef.current = null;
                                reject(new Error('SSE connection timeout'));
                            }, 10000);
                        }),
                    ]);
                    if (sseTimeoutId) clearTimeout(sseTimeoutId);
                    sseConnectedResolverRef.current = null;
                }

                // EPIC21 (F5): mark this thread as ainspace-conducted for the whole
                // round about to start, BEFORE the send, so agent turns that stream
                // back are attributed to ainspace. threadIdToSend is final here (new
                // thread already created above). Cleared when loading ends (effect).
                conductedSendRef.current = { threadId: threadIdToSend ?? null, inProgress: true };

                // Step 2: Send message (SSE is now connected)
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 30000);
                const response = await bffAuthFetch('/api/thread-message', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        message: userMessageText,
                        threadId: threadIdToSend,
                    }),
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                const result = await response.json();
                if (!response.ok) {
                    throw new Error(result.details || result.error || response.statusText);
                }

                // EPIC21: best-effort dual-write of the user turn (this send was
                // accepted). Identity comes from ids ainspace already holds — thread
                // userId = backend users.id (NOT wallet address), agents = current
                // thread roster. Fire-and-forget: never awaited, never throws.
                try {
                    const backendUser = useUserStore.getState().backendUser;
                    if (backendUser && threadIdToSend) {
                        const agents = selectedThread
                            ? rosterFromNames(selectedThread.agentNames)
                            : rosterFromNearby(nearbyAgents);
                        dualWriteTurn(
                            buildIngestPayload({
                                conversationId: threadIdToSend,
                                threadName: threadName || undefined,
                                user: { backendUserId: backendUser.id },
                                agents,
                                turns: [
                                    {
                                        kind: 'user',
                                        id: newMessage.id,
                                        content: userMessageText,
                                        timestamp: newMessage.timestamp.getTime(),
                                    },
                                ],
                            })
                        );
                    }
                } catch {
                    // Best-effort: never let dual-write affect the chat send path.
                }

                if (!isNewThread && result.threadId) {
                    updateThread(result.threadId, {
                        lastMessageAt: new Date().toISOString()
                    });
                }

                // Start response timeout — if no AI message within 60s, stop loading
                if (responseTimeoutRef.current) clearTimeout(responseTimeoutRef.current);
                responseTimeoutRef.current = setTimeout(() => {
                    setIsMessageLoading((loading) => {
                        if (!loading) return false;
                        const timeoutMessage: ChatMessage = {
                            id: `timeout-${Date.now()}`,
                            text: 'No response from agents. Please try again.',
                            timestamp: new Date(),
                            sender: 'system',
                            threadId: threadIdToSend
                        };
                        setMessages((prev) => [...prev, timeoutMessage], threadIdToSend);
                        setDisplayedMessages((prev) => [...prev, timeoutMessage]);
                        return false;
                    });
                    responseTimeoutRef.current = null;
                }, 60000);
            } catch (error) {
                console.error('Failed to send thread message:', error);

                const isTimeout = error instanceof Error && error.name === 'AbortError';
                // EPIC15: none of the nearby agents are registered in the backend
                // workspace, so a DM can't be created — expected, not an error.
                const isNoAgents = error instanceof Error && error.message === 'NO_RESOLVABLE_AGENTS';
                const errorText = isNoAgents
                    ? '참여 가능한 에이전트가 없어 대화를 시작할 수 없습니다.'
                    : isTimeout
                    ? 'Message timeout - the conversation is taking longer than expected. Please try again.'
                    : `Failed to send message: ${error instanceof Error ? error.message : 'Unknown error'}`;

                const errorMessage: ChatMessage = {
                    id: `error-${Date.now()}`,
                    text: errorText,
                    timestamp: new Date(),
                    sender: 'system',
                    threadId: threadIdToSend
                };
                if (responseTimeoutRef.current) {
                    clearTimeout(responseTimeoutRef.current);
                    responseTimeoutRef.current = null;
                }

                if (!threadIdToSend || threadIdToSend === '0') {
                    setDisplayedMessages([]);
                    setMessages([], '0');
                } else {
                    setMessages((prev) => [...prev, errorMessage], threadIdToSend);
                }

                if (!isNoAgents) {
                    Sentry.captureException(error instanceof Error ? error : new Error('Failed to send thread message'), {
                        tags: { component: 'ChatBox', action: 'sendMessage' },
                        extra: { threadName, threadId: threadIdToSend, agentNames, isTimeout }
                    });
                }
                setIsMessageLoading(false);
            }
        }
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (showSuggestions && filteredAgents.length > 0) {
            e.stopPropagation();

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedSuggestionIndex((prev) => (prev < filteredAgents.length - 1 ? prev + 1 : 0));
                return;
            }

            if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedSuggestionIndex((prev) => (prev > 0 ? prev - 1 : filteredAgents.length - 1));
                return;
            }

            if (e.key === 'Tab' || e.key === 'Enter') {
                e.preventDefault();
                if (filteredAgents[selectedSuggestionIndex]) {
                    selectSuggestion(filteredAgents[selectedSuggestionIndex]);
                }
                return;
            }

            if (e.key === 'Escape') {
                e.preventDefault();
                setShowSuggestions(false);
                setFilteredAgents([]);
                setSelectedSuggestionIndex(0);
                return;
            }
        }

        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    // Handle input changes and check for @ mentions
    const handleInputChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            e.preventDefault();

            const value = e.target.value;
            const cursorPos = e.target.selectionStart || 0;

            setInputValue(value);
            setCursorPosition(cursorPos);

            // Check if we're typing an @ mention
            const beforeCursor = value.substring(0, cursorPos);
            const atMatch = beforeCursor.match(/@(\w*)$/);

            if (atMatch) {
                const searchLower = atMatch[1].toLowerCase();
                const filtered = nearbyAgents.filter((agent) => agent.name.toLowerCase().includes(searchLower));
                setFilteredAgents(filtered);
                setShowSuggestions(filtered.length > 0);
                setSelectedSuggestionIndex(0);
            } else {
                setShowSuggestions(false);
                setFilteredAgents([]);
                setSelectedSuggestionIndex(0);
            }
        },
        [nearbyAgents]
    );

    // Handle suggestion selection
    const selectSuggestion = useCallback(
        (agent: AgentState) => {
            const beforeCursor = inputValue.substring(0, cursorPosition);
            const afterCursor = inputValue.substring(cursorPosition);
            const atMatch = beforeCursor.match(/@(\w*)$/);

            if (atMatch) {
                const beforeAt = beforeCursor.substring(0, beforeCursor.length - atMatch[0].length);
                const newValue = beforeAt + `@${agent.name} ` + afterCursor;
                setInputValue(newValue);
                setShowSuggestions(false);
                setFilteredAgents([]);
                setSelectedSuggestionIndex(0);

                // Focus back to input
                setTimeout(() => {
                    if (inputRef.current) {
                        const newCursorPos = beforeAt.length + agent.name.length + 2;
                        inputRef.current.focus();
                        inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
                    }
                }, 0);
            }
        },
        [inputValue, cursorPosition]
    );

    const unplacedPlaceholder = 'Agents have left the village...';

    const showUnplacedNotice = hasUnplacedAgents && inputValue.trim().length === 0;

    // Global keyboard shortcuts: Enter to focus, Escape to end conversation
    useEffect(() => {
        const handleGlobalKeyDown = (e: KeyboardEvent) => {
            // Suggestion dropdown이 열려있으면 글로벌 키 핸들링 하지 않음
            if (showSuggestions) return;

            // Escape: end conversation (same as End Conversation button)
            if (e.key === 'Escape') {
                if (!currentThreadId || currentThreadId === '0') return;
                if (isMessageLoading) return;
                e.preventDefault();
                handleEndConversation();
                inputRef.current?.blur();
                return;
            }

            // Enter: focus chat input
            if (e.key === 'Enter') {
                if (isMessageLoading || showUnplacedNotice) return;

                const active = document.activeElement;
                if (active) {
                    const tag = active.tagName.toLowerCase();
                    if (tag === 'input' || tag === 'textarea' || (active as HTMLElement).isContentEditable) return;
                }

                e.preventDefault();
                inputRef.current?.focus();
            }
        };

        window.addEventListener('keydown', handleGlobalKeyDown);
        return () => window.removeEventListener('keydown', handleGlobalKeyDown);
    }, [isMessageLoading, showUnplacedNotice, currentThreadId, showSuggestions]);

    const handleEndConversation = () => {
        setMessages([], '0');
        setDisplayedMessages([]);
        setCurrentThreadId('0');
    };

    const inputPlaceholder = showUnplacedNotice
        ? unplacedPlaceholder
        : isMessageLoading
          ? 'Agents are talking...'
          : 'Typing Message...';

    const placeholderStyle = showUnplacedNotice
        ? 'placeholder:text-[#FFB020]'
        : isMessageLoading
          ? 'placeholder:text-[#49C7FF] placeholder:font-light'
          : 'placeholder:text-[#FFFFFF66]';

    // EPIC19: surface an exhausted SSE auth recovery as a render throw so the
    // nearest (local) error boundary catches it — no silent system-message error.
    if (fatalStreamError) throw fatalStreamError;

    return (
        <div className={cn('flex h-full min-h-0 w-full flex-col bg-transparent', className)}>
            {/* NOTE: Chat Messages */}
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto scrollbar-hide p-4 pt-2">
                {displayedMessages.map((message) => (
                    <ChatMessageCard key={message.id} message={message} />
                ))}
                {
                  isDesktop && currentThreadId !== '0' && !isMessageLoading && (
                    <div className="flex items-start justify-start">
                        <button
                          onClick={handleEndConversation}
                          className="bg-[#5F666F66] text-white font-semibold text-sm rounded-lg border border-[#969EAA] p-2 active:bg-[#5C2A4A] active:border-[#E8837C]"
                        >
                            <div className="flex flex-row items-center gap-1 ">
                                <X className="size-4" />
                                <span>End Conversation</span>
                            </div>
                        </button>
                    </div>
                  )
                }
                <div ref={messagesEndRef} />
            </div>

            {/* NOTE: Loading Spinner - Fixed at bottom above input */}
            {isMessageLoading && !showUnplacedNotice && (
                <div className="flex justify-center bg-transparent py-2">
                    <Spinner className="size-4 text-white" />
                </div>
            )}

            {/* NOTE: Chat Input Area */}
            <div className={cn('relative w-full', isDesktop ? 'bg-[#222529]' : 'bg-black/30 backdrop-blur-[6px]')}>
                {showSuggestions && filteredAgents.length > 0 && (
                    <MentionSuggestionDropdown
                        agents={filteredAgents}
                        selectedIndex={selectedSuggestionIndex}
                        onSelect={selectSuggestion}
                    />
                )}

                <div className={cn('flex w-full items-center justify-center gap-1.5 self-stretch p-3')}>
                    <div className="rounded-full bg-black/30 p-2" onClick={openThreadList}>
                        <Image
                            src="/footer/bottomTab/tab_icon_bubble.svg"
                            className="h-4 w-4"
                            alt="Chat"
                            width={16}
                            height={16}
                        />
                    </div>
                    <div className="relative flex-1">
                        {showUnplacedNotice && (
                            <AlertTriangle className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[#FFB020]" />
                        )}
                        <input
                            ref={inputRef}
                            type="text"
                            value={inputValue}
                            onChange={handleInputChange}
                            onKeyDown={handleKeyPress}
                            placeholder={inputPlaceholder}
                            className={cn(
                                'h-10 w-full cursor-pointer rounded-[100px] bg-black/30 pr-2.5 text-base leading-5 text-white disabled:cursor-not-allowed disabled:opacity-60',
                                showUnplacedNotice ? 'pl-9' : 'pl-2.5',
                                placeholderStyle
                            )}
                            disabled={isMessageLoading || showUnplacedNotice}
                        />
                    </div>
                    <button
                        className={`flex h-[30px] w-[30px] items-center justify-center rounded-lg ${isMessageLoading ? 'bg-gray-300/60' : 'bg-white'}`}
                        onClick={() => handleSendMessage()}
                        disabled={isMessageLoading}
                    >
                        <Triangle className="text-xs font-bold text-black" fill="black" width={12} height={9} />
                    </button>
                </div>
            </div>
        </div>
    );
});

export default ChatBox;
