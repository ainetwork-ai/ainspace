'use client';

import { useState, useRef, useEffect, useCallback, forwardRef } from 'react';
import { cn } from '@/lib/utils';
import Image from 'next/image';
import { ChatMessage, useBuildStore, useChatStore, useGameStateStore, useThreadStore, useUserStore } from '@/stores';
import { BROADCAST_RADIUS, INITIAL_PLAYER_POSITION } from '@/constants/game';
import * as Sentry from '@sentry/nextjs';
import { useThreadStream } from '@/hooks/useThreadStream';
import { StreamEvent } from '@/lib/a2aOrchestration';
import { AlertTriangle, Triangle } from 'lucide-react';
import ChatMessageCard from '@/components/chat/ChatMessageCard';
import { AgentState } from '@/lib/agent';
import { generateAgentComboId } from '@/lib/hash';
import { Spinner } from '@/components/ui/spinner';

interface ChatBoxProps {
    className?: string;
    onAddMessage?: (message: ChatMessage) => void;
    openThreadList: () => void;
    aiCommentary?: string;
    onThreadSelect?: (threadId: string | undefined) => void;
    onResetLocation?: () => void;
    currentAgentsInRadius: AgentState[];
}

export interface ChatBoxRef {
    sendMessage: (message: string, threadId?: string, broadcastRadius?: number) => Promise<void>;
}

const ChatBox = forwardRef<ChatBoxRef, ChatBoxProps>(function ChatBox(
    { className = '', aiCommentary, onResetLocation, openThreadList, currentAgentsInRadius },
    ref
) {
    const { messages, setMessages, getMessagesByThreadId } = useChatStore();
    const { currentThreadId, setCurrentThreadId, findThreadByName, findThreadById, addThread } = useThreadStore();
    const [inputValue, setInputValue] = useState('');
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [filteredAgents, setFilteredAgents] = useState<AgentState[]>([]);
    const [cursorPosition, setCursorPosition] = useState(0);
    const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
    const [isMessageLoading, setIsMessageLoading] = useState(false);
    const { showCollisionMap, setShowCollisionMap, updateCollisionMapFromImage, publishedTiles, setCollisionMap } =
        useBuildStore();
    const inputRef = useRef<HTMLInputElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

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
    const { worldPosition: playerPosition } = useGameStateStore();
    const { updateThread } = useThreadStore();

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
                return;
            }

            if (event.type === 'message') {
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
            const userMessageText = inputValue.trim();
            const currentPlayerPosition = playerPosition || INITIAL_PLAYER_POSITION;

            setInputValue('');
            setIsMessageLoading(true);

            const agentNames: string[] = [];

            const isCurrentThreadSelected = currentThreadId && currentThreadId !== '0';

            const selectedThread = isCurrentThreadSelected ? findThreadById(currentThreadId) : undefined;
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
                currentAgentsInRadius.forEach((a: AgentState) => {
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

            // Extract mentioned agents from message
            const mentionMatches = userMessageText.match(/@(\w+)/g);
            const mentionedAgents = mentionMatches?.map((m) => m.substring(1)) || [];

            try {
                // Send message through A2A Orchestration API with timeout
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
                const response = await fetch('/api/thread-message', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        message: userMessageText,
                        playerPosition: currentPlayerPosition,
                        broadcastRadius: BROADCAST_RADIUS,
                        threadId: threadIdToSend,
                        agentNames: agentNames, // Explicitly pass the agent list calculated on frontend
                        mentionedAgents: mentionedAgents.length > 0 ? mentionedAgents : undefined,
                        userId: userId
                    }),
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                const result = await response.json();

                if (!response.ok) {
                    throw new Error(result.details || result.error || response.statusText);
                }

                console.log('Thread message sent:', result);

                // Store the mapping between thread name and backend thread ID
                if (result.threadId) {
                    updateThread(result.threadId, {
                        lastMessageAt: new Date().toISOString()
                    });
                    console.log('Backend thread ID:', result.threadId);
                    const resultThread = findThreadById(result.threadId);

                    // Save the mapping if it's new
                    if (!resultThread) {
                        console.log('Saving mapping:', threadName, '→', result.threadId);
                        const agentComboId = await generateAgentComboId(agentNames);
                        addThread({
                            threadName,
                            id: result.threadId,
                            agentNames: agentNames,
                            agentComboId,
                            createdAt: new Date().toISOString(),
                            lastMessageAt: new Date().toISOString()
                        });

                        setMessages((prev) => {
                            if (!prev) return [newMessage];
                            return [...prev, newMessage];
                        }, result.threadId);

                        setMessages([], '0');

                        // Save to backend (async, don't wait)
                        console.log('Saving thread mapping:', {
                            userId: userId,
                            threadName,
                            id: result.threadId,
                            agentNames: agentNames
                        });

                        setCurrentThreadId(result.threadId);

                        if (userId) {
                            fetch('/api/threads', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    userId: userId,
                                    threadName,
                                    id: result.threadId,
                                    agentNames: agentNames
                                })
                            }).catch((err) => console.error('Failed to save thread mapping:', err));
                        }
                    }

                    // For new threads, wait a bit for backend to fully process
                    // For existing threads, connect immediately
                    const delay = result.isNewThread ? 1000 : 100;
                    setTimeout(() => {
                        setHasStartedConversation(true);
                    }, delay);
                } else {
                    console.warn('Backend did not return thread ID');
                    // Still enable SSE with short delay
                    setTimeout(() => {
                        setHasStartedConversation(true);
                    }, 500);
                }
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
                setMessages((prev) => [...prev, errorMessage], threadIdToSend);

                // Log to Sentry
                Sentry.captureException(error instanceof Error ? error : new Error('Failed to send thread message'), {
                    tags: {
                        component: 'ChatBox',
                        action: 'sendMessage'
                    },
                    extra: {
                        threadName,
                        threadId: threadIdToSend,
                        agentNames: agentNames,
                        isTimeout
                    }
                });
                setIsMessageLoading(false);
            }
        }
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (showSuggestions && filteredAgents.length > 0) {
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

            // if (atMatch) {
            //     const searchTerm = atMatch[1];
            //     const filtered = getAgentSuggestions(searchTerm);
            //     setFilteredAgents(filtered);
            //     setShowSuggestions(filtered.length > 0);
            //     setSelectedSuggestionIndex(0);
            // } else {
            setShowSuggestions(false);
            setFilteredAgents([]);
            setSelectedSuggestionIndex(0);
            // }
        },
        // [getAgentSuggestions]
        []
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
                <div ref={messagesEndRef} />
            </div>

            {/* NOTE: Loading Spinner - Fixed at bottom above input */}
            {isMessageLoading && !showUnplacedNotice && (
                <div className="flex justify-center bg-transparent py-2">
                    <Spinner className="size-4 text-white" />
                </div>
            )}

            {/* NOTE: Chat Input Area */}
            <div className={cn('w-full bg-transparent')}>
                {showSuggestions && filteredAgents.length > 0 && (
                    <div className="absolute right-3 bottom-full left-3 z-10 mb-1 max-h-32 overflow-y-auto rounded-md border border-gray-600 bg-gray-800 shadow-lg">
                        {filteredAgents.map((agent, index) => {
                            const distance = playerPosition
                                ? Math.sqrt(
                                      Math.pow(agent.x - playerPosition.x, 2) + Math.pow(agent.y - playerPosition.y, 2)
                                  )
                                : 0;

                            const isSelected = index === selectedSuggestionIndex;

                            return (
                                <button
                                    key={agent.id}
                                    onClick={() => selectSuggestion(agent)}
                                    className={cn(
                                        'flex w-full items-center justify-between px-3 py-2 text-left text-sm focus:outline-none',
                                        isSelected ? 'bg-blue-600 text-white' : 'text-gray-200 hover:bg-gray-700'
                                    )}
                                >
                                    <div className="flex items-center">
                                        <div
                                            className="mr-2 h-3 w-3 rounded-sm border border-gray-400"
                                            style={{ backgroundColor: agent.color }}
                                        ></div>
                                        <span className="font-medium">{agent.name}</span>
                                    </div>
                                    {showCollisionMap && (
                                        <div className={cn('text-xs', isSelected ? 'text-blue-200' : 'text-gray-400')}>
                                            ({agent.x}, {agent.y}) [{distance.toFixed(1)}u]
                                        </div>
                                    )}
                                </button>
                            );
                        })}
                    </div>
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
