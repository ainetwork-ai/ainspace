'use client';

import { useState, useRef, useEffect, useCallback, forwardRef } from 'react';
import { cn } from '@/lib/utils';
import Image from 'next/image';
import { ChatMessage, useBuildStore, useChatStore, useGameStateStore, useThreadStore, useUserStore } from '@/stores';
import * as Sentry from '@sentry/nextjs';
import { useThreadStream } from '@/hooks/useThreadStream';
import { StreamEvent } from '@/lib/a2aOrchestration';
import { AlertTriangle, Triangle, X } from 'lucide-react';
import ChatMessageCard from '@/components/chat/ChatMessageCard';
import { AgentState } from '@/lib/agent';
import MentionSuggestionDropdown from '@/components/chat/MentionSuggestionDropdown';
import { generateAgentComboId } from '@/lib/hash';
import { Spinner } from '@/components/ui/spinner';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useNearbyAgents } from '@/hooks/useNearbyAgents';

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
    const { setShowCollisionMap } = useBuildStore();
    const inputRef = useRef<HTMLInputElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const responseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const sseConnectedResolverRef = useRef<(() => void) | null>(null);

    const [displayedMessages, setDisplayedMessages] = useState<ChatMessage[]>([]);
    const activeThread = currentThreadId && currentThreadId !== '0' ? findThreadById(currentThreadId) : undefined;
    const unplacedAgentNames = activeThread?.unplacedAgentNames ?? [];
    const hasUnplacedAgents = !!(
        activeThread?.hasUnplacedAgents ||
        (unplacedAgentNames && unplacedAgentNames.length > 0)
    );

    // Track if a message has been sent (to enable SSE connection)
    const [hasStartedConversation, setHasStartedConversation] = useState(false);

    const userId = useUserStore((state) => state.getUserId());
    const { updateThread } = useThreadStore();
    const { isDesktop } = useIsDesktop();

    // Notify parent when loading state changes
    useEffect(() => {
        onLoadingChange?.(isMessageLoading);
    }, [isMessageLoading, onLoadingChange]);

    // FIXME(yoojin): move type
    interface BackendMessage {
        id: string;
        replyTo?: string;
        content: string;
        speaker: string;
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
                    threadId: threadId
                } as ChatMessage;
            });
        },
        [userId]
    );

    const fetchThreadMessages = useCallback(
        async (threadId: string) => {
            const response = await fetch(`/api/threads/${threadId}`);
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
            const currnetThreadMessages = getMessagesByThreadId(currentThreadId);
            if (currnetThreadMessages.length > 0) {
                setDisplayedMessages(currnetThreadMessages);
            } else {
                console.log('Fetching thread messages for thread ID:', currentThreadId);
                fetchThreadMessages(currentThreadId).then((messages) => {
                    setMessages(messages, currentThreadId);
                });
            }
        } else {
            setDisplayedMessages([]);
            setHasStartedConversation(false);
        }
    }, [currentThreadId, setMessages, getMessagesByThreadId, fetchThreadMessages]);

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

    // Handle SSE stream messages from A2A Orchestration
    const handleStreamEvent = useCallback(
        (event: StreamEvent) => {
            console.log('SSE Event received:', JSON.stringify(event, null, 2));

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
                // Message data is in data.data (nested structure from A2A Orchestration)
                const eventData = event.data as {
                    data?: { speaker?: string; content?: string };
                    sender?: string;
                    agentName?: string;
                    agent?: { name?: string };
                    name?: string;
                    content?: string;
                    message?: string;
                };
                const messageData = (eventData.data || eventData) as {
                    speaker?: string;
                    content?: string;
                    id?: string;
                };

                // Extract agent name from speaker field (A2A Orchestration format)
                const agentName =
                    messageData.speaker ||
                    eventData.sender ||
                    eventData.agentName ||
                    eventData.agent?.name ||
                    eventData.name ||
                    'agent';

                // Extract message content
                const messageContent =
                    messageData.content || eventData.content || eventData.message || JSON.stringify(eventData);

                console.log('Extracted agent name:', agentName);
                console.log('Extracted message content:', messageContent);

                // Add agent message to chat
                const agentMessage: ChatMessage = {
                    id: messageData.id || `stream-${Date.now()}-${Math.random()}`,
                    text: messageContent,
                    timestamp: new Date(),
                    sender: 'ai',
                    senderId: agentName,
                    threadId: currentThreadId || undefined
                };
                setMessages((prev) => {
                    if (!prev) return [agentMessage];
                    return [...prev, agentMessage];
                }, currentThreadId);
            } else if (event.type === 'block') {
                // Block messages are not displayed in chat (used for internal processing only)
                console.log('Block event (not displayed):', event.data);
                if (event.data.next?.id === 'user') {
                    if (responseTimeoutRef.current) {
                        clearTimeout(responseTimeoutRef.current);
                        responseTimeoutRef.current = null;
                    }
                    setIsMessageLoading(false);
                }
            } else if (event.type === 'error') {
                // Error message
                const errorMessage: ChatMessage = {
                    id: `error-${Date.now()}`,
                    text: `Error: ${event.data.error || 'Unknown error'}`,
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
        enabled: hasStartedConversation && !!currentThreadId && currentThreadId !== '0'
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
        if (!userId) return;

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
                    setHasStartedConversation(true);
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
                    const createResponse = await fetch('/api/thread-create', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ agentNames, userId }),
                    });
                    const createResult = await createResponse.json();
                    if (!createResponse.ok) {
                        throw new Error(createResult.details || createResult.error || createResponse.statusText);
                    }

                    threadIdToSend = createResult.threadId;

                    // Save thread mapping
                    const agentComboId = await generateAgentComboId(agentNames);
                    addThread({
                        threadName,
                        id: threadIdToSend!,
                        agentNames,
                        agentComboId,
                        createdAt: new Date().toISOString(),
                        lastMessageAt: new Date().toISOString()
                    });

                    setMessages((prev) => {
                        if (!prev) return [newMessage];
                        return [...prev, newMessage];
                    }, threadIdToSend!);
                    setMessages([], '0');

                    setCurrentThreadId(threadIdToSend!);

                    // Save to backend (async, don't wait)
                    if (userId) {
                        fetch('/api/threads', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                userId, threadName,
                                id: threadIdToSend,
                                agentNames,
                            })
                        }).catch((err) => console.error('Failed to save thread mapping:', err));
                    }

                    // Enable SSE and wait for connection
                    setHasStartedConversation(true);

                    // Wait for SSE 'connected' event (max 10s timeout)
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

                // Step 2: Send message (SSE is now connected)
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 30000);
                const response = await fetch('/api/thread-message', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        message: userMessageText,
                        threadId: threadIdToSend,
                        userId,
                    }),
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                const result = await response.json();
                if (!response.ok) {
                    throw new Error(result.details || result.error || response.statusText);
                }

                if (!isNewThread && result.threadId) {
                    updateThread(result.threadId, {
                        lastMessageAt: new Date().toISOString()
                    });
                    setHasStartedConversation(true);
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
                const errorText = isTimeout
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

                Sentry.captureException(error instanceof Error ? error : new Error('Failed to send thread message'), {
                    tags: { component: 'ChatBox', action: 'sendMessage' },
                    extra: { threadName, threadId: threadIdToSend, agentNames, isTimeout }
                });
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
        setHasStartedConversation(false);
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
