'use client';

import { useState, useRef, useEffect, useCallback, useMemo, forwardRef } from 'react';
import { useWorld } from '@/hooks/useWorld';
import { Agent, AgentResponse } from '@/lib/world';
import { cn } from '@/lib/utils';
import Image from 'next/image';
import { useBuildStore, useChatStore, useGameStateStore, useThreadStore } from '@/stores';
import { INITIAL_PLAYER_POSITION } from '@/constants/game';
import { useAccount } from 'wagmi';
import * as Sentry from '@sentry/nextjs';
import { useThreadStream } from '@/hooks/useThreadStream';
import { StreamEvent } from '@/lib/a2aOrchestration';
import { Triangle } from 'lucide-react';
import ChatMessage from './ChatMessage';

interface Message {
    id: string;
    text: string;
    timestamp: Date;
    sender: 'user' | 'system' | 'ai';
    senderId?: string;
    threadId?: string;
}

interface ChatBoxProps {
    className?: string;
    onAddMessage?: (message: Message) => void;
    openThreadList: () => void;
    aiCommentary?: string;
    agents?: Agent[];
    onThreadSelect?: (threadId: string | undefined) => void;
    onResetLocation?: () => void;
}

export interface ChatBoxRef {
    sendMessage: (message: string, threadId?: string, broadcastRadius?: number) => Promise<void>;
}

const ChatBox = forwardRef<ChatBoxRef, ChatBoxProps>(function ChatBox(
    { className = '', aiCommentary, agents = [], onResetLocation, openThreadList },
    ref
) {
    const { messages, setMessages, getMessagesByThread } = useChatStore();
    const { currentThreadId, setCurrentThreadId } = useThreadStore();
    const [inputValue, setInputValue] = useState('');
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [filteredAgents, setFilteredAgents] = useState<Agent[]>([]);
    const [cursorPosition, setCursorPosition] = useState(0);
    const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
    const { showCollisionMap, setShowCollisionMap, updateCollisionMapFromImage, publishedTiles, setCollisionMap } =
        useBuildStore();
    const inputRef = useRef<HTMLInputElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const [displayedMessages, setDisplayedMessages] = useState<Message[]>([]);

    // Track if a message has been sent (to enable SSE connection)
    const [hasStartedConversation, setHasStartedConversation] = useState(false);
    // Map thread names (our generated IDs) to backend thread IDs
    const [threadNameToIdMap, setThreadNameToIdMap] = useState<{ [threadName: string]: string }>({});

    const { address } = useAccount();
    const { worldPosition: playerPosition } = useGameStateStore();

    useEffect(() => {
        if (currentThreadId) {
            setDisplayedMessages(getMessagesByThread(currentThreadId));
        }
    }, [currentThreadId, getMessagesByThread]);

    // Store full thread data including agent names
    const [fullThreadData, setFullThreadData] = useState<{
        [threadName: string]: {
            backendThreadId: string;
            agentNames: string[];
        };
    }>({});

    // Generate deterministic thread ID from agent names and user address
    const generateThreadId = useCallback((agentNames: string[], userAddress?: string): string => {
        if (agentNames.length === 0) return '';
        // Sort names for consistency and create hash-like ID
        const sortedNames = [...agentNames].sort();
        const agentString = sortedNames
            .join('-')
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, '');
        // Include user address (shortened) to make threads user-specific
        const userPrefix = userAddress ? userAddress.slice(0, 8).toLowerCase() : 'anon';
        return `thread-${userPrefix}-${agentString}`;
    }, []);

    // Get current agents in radius
    const getCurrentAgentsInRadius = useCallback(() => {
        if (!playerPosition) return [];

        const broadcastRadius = 10;
        return agents.filter((agent) => {
            const distance = Math.sqrt(
                Math.pow(agent.x - playerPosition.x, 2) + Math.pow(agent.y - playerPosition.y, 2)
            );
            return distance <= broadcastRadius;
        });
    }, [agents, playerPosition]);

    // Get all threads (from thread name map)
    const allThreads = useMemo(() => {
        return Object.keys(threadNameToIdMap).map((threadName) => ({
            threadName,
            backendThreadId: threadNameToIdMap[threadName],
            agentNames: fullThreadData[threadName]?.agentNames || [], // Use stored agent names
            isActive: threadName === currentThreadId
        }));
    }, [threadNameToIdMap, currentThreadId, fullThreadData]);

    // Delete a thread
    const deleteThread = useCallback(
        async (threadName: string, e: React.MouseEvent) => {
            e.stopPropagation(); // Prevent thread selection when clicking delete

            if (!address) return;

            try {
                const response = await fetch(`/api/threads?userId=${address}&threadName=${threadName}`, {
                    method: 'DELETE'
                });

                if (!response.ok) {
                    console.error('Failed to delete thread');
                    return;
                }

                console.log('Thread deleted:', threadName);

                // Remove from local state
                const newThreadNameToIdMap = { ...threadNameToIdMap };
                delete newThreadNameToIdMap[threadName];
                setThreadNameToIdMap(newThreadNameToIdMap);

                const newFullThreadData = { ...fullThreadData };
                delete newFullThreadData[threadName];
                setFullThreadData(newFullThreadData);

                // If this was the active thread, clear it
                if (currentThreadId === threadName) {
                    setCurrentThreadId(undefined);
                    setHasStartedConversation(false);
                }
            } catch (error) {
                console.error('Error deleting thread:', error);
            }
        },
        [address, threadNameToIdMap, fullThreadData, currentThreadId]
    );

    // Update activeThreadId when prop changes (only if it's a valid thread ID)
    useEffect(() => {
        if (currentThreadId && currentThreadId !== '0' && currentThreadId !== 'undefined') {
            setCurrentThreadId(currentThreadId);
        }
    }, [currentThreadId]);

    // Initialize world system
    const { sendMessage: worldSendMessage, getAgentSuggestions } = useWorld({
        agents: agents || [],
        playerPosition: playerPosition || INITIAL_PLAYER_POSITION,
        onAgentResponse: (response: AgentResponse & { threadId?: string }) => {
            const { agentId, message, threadId, nextAgentRequest } = response;
            // Add agent response to chat with thread ID
            const agentMessage: Message = {
                id: `agent-${agentId}-${Date.now()}`,
                text: message,
                timestamp: new Date(),
                sender: 'ai',
                senderId: agentId,
                threadId: threadId || currentThreadId || undefined
            };

            console.log('Agent response received:', {
                agentId: agentId,
                message: message,
                threadId: agentMessage.threadId,
                currentThreadId
            });

            setMessages((prev) => [...prev, agentMessage]);

            nextAgentRequest.forEach(async (req) => {
                worldSendMessage(req, agentMessage.threadId);
            });
        }
    });

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
                const agentMessage: Message = {
                    id: messageData.id || `stream-${Date.now()}-${Math.random()}`,
                    text: messageContent,
                    timestamp: new Date(),
                    sender: 'ai',
                    senderId: agentName,
                    threadId: currentThreadId || undefined
                };
                setMessages((prev) => [...prev, agentMessage]);
            } else if (event.type === 'block') {
                // Block messages are not displayed in chat (used for internal processing only)
                console.log('Block event (not displayed):', event.data);
            } else if (event.type === 'error') {
                // Error message
                const errorMessage: Message = {
                    id: `error-${Date.now()}`,
                    text: `Error: ${event.data.error || 'Unknown error'}`,
                    timestamp: new Date(),
                    sender: 'system',
                    threadId: currentThreadId || undefined
                };
                setMessages((prev) => [...prev, errorMessage]);
            }
        },
        [currentThreadId, setMessages]
    );

    // Connect to SSE stream for current thread (only after conversation has started)
    // Use the backend thread ID from our mapping
    const backendThreadId = currentThreadId ? threadNameToIdMap[currentThreadId] : null;

    useThreadStream({
        threadId: backendThreadId || null,
        onMessage: handleStreamEvent,
        enabled:
            hasStartedConversation && !!backendThreadId && backendThreadId !== '0' && backendThreadId !== 'undefined'
    });

    // Expose sendMessage function to parent components
    // useImperativeHandle(
    //     ref,
    //     () => ({
    //         sendMessage: async (message: string, threadId?: string, broadcastRadius?: number) => {
    //             const newMessage: Message = {
    //                 id: Date.now().toString(),
    //                 text: message,
    //                 timestamp: new Date(),
    //                 sender: 'user',
    //                 threadId: threadId || activeThreadId || undefined
    //             };
    //             console.log('SendMessage (imperative):', {
    //                 message,
    //                 threadId,
    //                 broadcastRadius,
    //                 messageId: newMessage.id
    //             });
    //             setMessages((prev) => [...prev, newMessage]);
    //             await worldSendMessage(message, threadId, broadcastRadius);
    //         }
    //     }),
    //     [worldSendMessage, currentThreadId]
    // );

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // Add AI commentary to messages when it changes
    useEffect(() => {
        if (aiCommentary && aiCommentary.trim()) {
            const aiMessage: Message = {
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
                return [...prev, aiMessage];
            });
        }
    }, [aiCommentary]);

    const handleSendMessage = async () => {
        if (inputValue.trim() === 'show me grid') {
            setShowCollisionMap(true);
            setInputValue('');
        } else if (inputValue.trim() === 'exit') {
            setShowCollisionMap(false);
            setInputValue('');
        } else if (inputValue.trim() === 'reset location') {
            setInputValue('');
            if (onResetLocation) {
                onResetLocation();
                const systemMessage: Message = {
                    id: `system-${Date.now()}`,
                    text: 'Player and agents have been reset to their initial positions (63, 58).',
                    timestamp: new Date(),
                    sender: 'system',
                    threadId: undefined
                };
                setMessages((prev) => [...prev, systemMessage]);
            } else {
                const errorMessage: Message = {
                    id: `system-${Date.now()}`,
                    text: 'Reset location is not available.',
                    timestamp: new Date(),
                    sender: 'system',
                    threadId: undefined
                };
                setMessages((prev) => [...prev, errorMessage]);
            }
        } else if (inputValue.trim() === 'clear items') {
            setInputValue('');
            const systemMessage: Message = {
                id: `system-${Date.now()}`,
                text: 'Clearing all placed items...',
                timestamp: new Date(),
                sender: 'system',
                threadId: undefined
            };
            setMessages((prev) => [...prev, systemMessage]);

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

                const successMessage: Message = {
                    id: `system-${Date.now()}`,
                    text: `All items have been cleared! Deleted ${data.deletedCount} tiles. All 6 items are now available for placement again.`,
                    timestamp: new Date(),
                    sender: 'system',
                    threadId: undefined
                };
                setMessages((prev) => [...prev, successMessage]);
            } catch (error) {
                const errorMessage: Message = {
                    id: `system-${Date.now()}`,
                    text: `Failed to clear items: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    timestamp: new Date(),
                    sender: 'system',
                    threadId: undefined
                };
                setMessages((prev) => [...prev, errorMessage]);
            }
        } else if (inputValue.trim() === 'update layer1') {
            setInputValue('');
            const systemMessage: Message = {
                id: `system-${Date.now()}`,
                text: 'Updating collision map from land_layer_1.webp and published tiles...',
                timestamp: new Date(),
                sender: 'system',
                threadId: undefined
            };
            setMessages((prev) => [...prev, systemMessage]);

            try {
                // Step 1: Update collision map from land_layer_1.webp image
                await updateCollisionMapFromImage('/map/land_layer_1.webp');

                // Step 2: Get the updated collision map and merge with published layer1 items
                const currentCollisionMap = useBuildStore.getState().collisionMap;
                const layer1Items = publishedTiles.layer1 || {};

                // Combine both sources
                const mergedCollisionMap: { [key: string]: boolean } = { ...currentCollisionMap };
                Object.keys(layer1Items).forEach((key) => {
                    mergedCollisionMap[key] = true;
                });

                // Update the collision map with merged data
                setCollisionMap(mergedCollisionMap);

                const imageBlockedCount = Object.keys(currentCollisionMap).length;
                const layer1ItemsCount = Object.keys(layer1Items).length;
                const totalBlockedCount = Object.keys(mergedCollisionMap).length;

                const successMessage: Message = {
                    id: `system-${Date.now()}`,
                    text: `Collision map updated successfully! ${imageBlockedCount} tiles from image + ${layer1ItemsCount} published items = ${totalBlockedCount} total blocked tiles. Use "show me grid" to view.`,
                    timestamp: new Date(),
                    sender: 'system',
                    threadId: undefined
                };
                setMessages((prev) => [...prev, successMessage]);
            } catch (error) {
                const errorMessage: Message = {
                    id: `system-${Date.now()}`,
                    text: `Failed to update collision map: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    timestamp: new Date(),
                    sender: 'system',
                    threadId: undefined
                };
                setMessages((prev) => [...prev, errorMessage]);
            }
        } else if (inputValue.trim()) {
            const userMessageText = inputValue.trim();
            const currentPlayerPosition = playerPosition || INITIAL_PLAYER_POSITION;

            // Get current agents in radius
            const agentsInRadius = getCurrentAgentsInRadius();

            // Sort agent names for consistent comparison
            const currentAgentNames = agentsInRadius.map((a) => a.name).sort();

            // Generate deterministic thread name from agent combination and user address
            const threadName = generateThreadId(currentAgentNames, address);

            console.log('Current agents in radius:', currentAgentNames);
            console.log('Generated thread name:', threadName);

            // Check if we already have a backend thread ID for this agent combination
            const existingBackendThreadId = threadNameToIdMap[threadName];

            console.log('Existing backend thread ID:', existingBackendThreadId);
            console.log('Previous active thread ID:', currentThreadId);

            // Determine which backend thread ID to use
            // If we have an existing mapping, use it; otherwise send undefined to create new
            const backendThreadIdToSend = existingBackendThreadId || undefined;

            // Check if we're switching to a different thread
            const threadChanged = threadName !== currentThreadId;

            if (threadChanged) {
                console.log('Agent combination changed - switching to thread:', threadName);
                setCurrentThreadId(threadName);

                // If we're using an existing thread, we can start conversation immediately
                // If it's new, we'll wait for backend response
                if (existingBackendThreadId) {
                    setHasStartedConversation(true);
                } else {
                    setHasStartedConversation(false);
                }

                // Add system message to notify user about thread change
                if (currentThreadId) {
                    const systemMessage: Message = {
                        id: `system-${Date.now()}`,
                        text: `Switched to conversation with: ${currentAgentNames.join(', ')}`,
                        timestamp: new Date(),
                        sender: 'system',
                        threadId: threadName
                    };
                    setMessages((prev) => [...prev, systemMessage]);
                }
            }

            const newMessage: Message = {
                id: Date.now().toString(),
                text: userMessageText,
                timestamp: new Date(),
                sender: 'user',
                senderId: address || undefined,
                threadId: threadName
            };

            console.log('HandleSendMessage:', {
                text: newMessage.text,
                threadName: threadName,
                backendThreadIdToSend: backendThreadIdToSend,
                messageId: newMessage.id,
                threadChanged,
                agentsInRadius: currentAgentNames,
                isNewThread: !backendThreadIdToSend,
                previousThreadId: currentThreadId
            });

            setMessages((prev) => [...prev, newMessage]);
            setInputValue('');

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
                        broadcastRadius: 10,
                        threadId: backendThreadIdToSend,
                        agentNames: currentAgentNames, // Explicitly pass the agent list calculated on frontend
                        mentionedAgents: mentionedAgents.length > 0 ? mentionedAgents : undefined
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
                    console.log('Backend thread ID:', result.threadId);

                    // Save the mapping if it's new
                    if (!threadNameToIdMap[threadName]) {
                        console.log('Saving mapping:', threadName, '→', result.threadId);

                        // Update local state IMMEDIATELY
                        setThreadNameToIdMap((prev) => ({
                            ...prev,
                            [threadName]: result.threadId
                        }));

                        // Update full thread data
                        setFullThreadData((prev) => ({
                            ...prev,
                            [threadName]: {
                                backendThreadId: result.threadId,
                                agentNames: currentAgentNames
                            }
                        }));

                        // Save to backend (async, don't wait)
                        if (address) {
                            fetch('/api/threads', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    userId: address,
                                    threadName,
                                    backendThreadId: result.threadId,
                                    agentNames: currentAgentNames
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

                const errorMessage: Message = {
                    id: `error-${Date.now()}`,
                    text: errorText,
                    timestamp: new Date(),
                    sender: 'system',
                    threadId: threadName
                };
                setMessages((prev) => [...prev, errorMessage]);

                // Log to Sentry
                Sentry.captureException(error instanceof Error ? error : new Error('Failed to send thread message'), {
                    tags: {
                        component: 'ChatBox',
                        action: 'sendMessage'
                    },
                    extra: {
                        threadName,
                        backendThreadId: backendThreadIdToSend,
                        agentNames: currentAgentNames,
                        isTimeout
                    }
                });
            }
        }
    };

    // Filter messages by current thread
    const threadMessages = currentThreadId
        ? messages.filter((msg) => msg.threadId === currentThreadId)
        : messages.filter((msg) => !msg.threadId);

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

            if (atMatch) {
                const searchTerm = atMatch[1];
                const filtered = getAgentSuggestions(searchTerm);
                setFilteredAgents(filtered);
                setShowSuggestions(filtered.length > 0);
                setSelectedSuggestionIndex(0);
            } else {
                setShowSuggestions(false);
                setFilteredAgents([]);
                setSelectedSuggestionIndex(0);
            }
        },
        [getAgentSuggestions]
    );

    // Handle suggestion selection
    const selectSuggestion = useCallback(
        (agent: Agent) => {
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

    // Get current agents in radius for display
    const currentAgentsInRadius = getCurrentAgentsInRadius();
    const currentAgentNames = currentAgentsInRadius.map((a) => a.name).sort();
    const previewThreadName = generateThreadId(currentAgentNames, address);

    return (
        <div className={cn('flex h-full min-h-0 w-full flex-col bg-transparent', className)}>
            {/* NOTE: Chat Messages */}
            <div className="flex-1 overflow-y-auto p-4 pt-2">
                {threadMessages.slice().map((message) => (
                    <ChatMessage key={message.id} message={message} />
                ))}
                <div ref={messagesEndRef} />
            </div>

            {/* NOTE: Chat Input Area */}
            <div
                className={cn(
                    'w-full bg-transparent'
                    // "absolute right-0 bottom-0"
                )}
            >
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

                <div
                    className={cn(
                        'flex w-full items-center justify-center gap-1.5 self-stretch p-3'
                        // "fixed right-0 bottom-0"
                    )}
                >
                    <div className="rounded-full bg-black/30 p-2" onClick={openThreadList}>
                        <Image
                            src="/footer/bottomTab/tab_icon_bubble.svg"
                            className="h-4 w-4"
                            alt="Chat"
                            width={16}
                            height={16}
                        />
                    </div>
                    <input
                        ref={inputRef}
                        type="text"
                        value={inputValue}
                        onChange={handleInputChange}
                        onKeyDown={handleKeyPress}
                        autoFocus={true}
                        placeholder="Typing Message..."
                        className="flex flex-1 cursor-pointer rounded-[100px] bg-black/30 px-2.5 py-2 text-white placeholder:text-[#FFFFFF66]"
                    />
                    <button
                        className="flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-white"
                        onClick={() => handleSendMessage()}
                    >
                        <Triangle className="text-xs font-bold text-black" fill="black" width={12} height={9} />
                    </button>
                </div>
            </div>
        </div>
    );
});

export default ChatBox;
