'use client';

import { useState, useRef, useEffect, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';
import { useWorld } from '@/hooks/useWorld';
import { Agent, AgentResponse } from '@/lib/world';
import { cn, shortAddress } from '@/lib/utils';
import Image from 'next/image';
import { useBuildStore, useChatStore, useGameStateStore } from '@/stores';
import { INITIAL_PLAYER_POSITION, AGENT_RESPONSE_DISTANCE } from '@/constants/game';
import { useAccount } from 'wagmi';
import { useThreadStream } from '@/hooks/useThreadStream';
import { StreamEvent } from '@/lib/a2aOrchestration';

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
    aiCommentary?: string;
    agents?: Agent[];
    currentThreadId?: string;
    threads?: Array<{
        id: string;
        message: string;
        timestamp: Date;
        agentsReached: number;
        agentNames: string[];
    }>;
    onThreadSelect?: (threadId: string | undefined) => void;
    onResetLocation?: () => void;
    userId?: string | null;
}

export interface ChatBoxRef {
    sendMessage: (message: string, threadId?: string, broadcastRadius?: number) => Promise<void>;
}

const ChatBox = forwardRef<ChatBoxRef, ChatBoxProps>(function ChatBox(
    { className = '', aiCommentary, agents = [], currentThreadId, onResetLocation },
    ref
) {
    const { messages, setMessages } = useChatStore();
    const [inputValue, setInputValue] = useState('');
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [filteredAgents, setFilteredAgents] = useState<Agent[]>([]);
    const [cursorPosition, setCursorPosition] = useState(0);
    const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
    const { showCollisionMap, setShowCollisionMap, updateCollisionMapFromImage, publishedTiles, setCollisionMap } =
        useBuildStore();
    const inputRef = useRef<HTMLInputElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Manage active thread ID internally (start with undefined, only set after first message)
    const [activeThreadId, setActiveThreadId] = useState<string | undefined>(undefined);
    // Track which agents are in the current thread
    const [threadAgentNames, setThreadAgentNames] = useState<string[]>([]);
    // Track if a message has been sent (to enable SSE connection)
    const [hasStartedConversation, setHasStartedConversation] = useState(false);
    // Map thread names (our generated IDs) to backend thread IDs
    const [threadNameToIdMap, setThreadNameToIdMap] = useState<{ [threadName: string]: string }>({});
    // Thread list menu state
    const [showThreadList, setShowThreadList] = useState(false);

    const { address } = useAccount();
    const { worldPosition: playerPosition } = useGameStateStore();

    // Store full thread data including agent names
    const [fullThreadData, setFullThreadData] = useState<{
        [threadName: string]: {
            backendThreadId: string;
            agentNames: string[]
        }
    }>({});

    // Load thread mappings from backend when component mounts
    useEffect(() => {
        if (!address) return;

        const loadThreadMappings = async () => {
            try {
                const response = await fetch(`/api/threads?userId=${address}`);
                if (!response.ok) {
                    console.error('Failed to load thread mappings');
                    return;
                }

                const data = await response.json();
                if (data.success && data.threads) {
                    // Convert thread mappings to our format
                    const mappings: { [threadName: string]: string } = {};
                    const fullData: { [threadName: string]: { backendThreadId: string; agentNames: string[] } } = {};

                    for (const [threadName, threadData] of Object.entries(data.threads)) {
                        const td = threadData as { backendThreadId: string; agentNames: string[] };
                        mappings[threadName] = td.backendThreadId;
                        fullData[threadName] = {
                            backendThreadId: td.backendThreadId,
                            agentNames: td.agentNames || []
                        };
                    }

                    setThreadNameToIdMap(mappings);
                    setFullThreadData(fullData);
                    console.log('Loaded thread mappings:', mappings);
                }
            } catch (error) {
                console.error('Error loading thread mappings:', error);
            }
        };

        loadThreadMappings();
    }, [address]);

    // Generate deterministic thread ID from agent names and user address
    const generateThreadId = useCallback((agentNames: string[], userAddress?: string): string => {
        if (agentNames.length === 0) return '';
        // Sort names for consistency and create hash-like ID
        const sortedNames = [...agentNames].sort();
        const agentString = sortedNames.join('-').toLowerCase().replace(/[^a-z0-9-]/g, '');
        // Include user address (shortened) to make threads user-specific
        const userPrefix = userAddress ? userAddress.slice(0, 8).toLowerCase() : 'anon';
        return `thread-${userPrefix}-${agentString}`;
    }, []);

    // Get current agents in radius
    const getCurrentAgentsInRadius = useCallback(() => {
        if (!playerPosition) return [];

        const broadcastRadius = 10;
        return agents.filter(agent => {
            const distance = Math.sqrt(
                Math.pow(agent.x - playerPosition.x, 2) +
                Math.pow(agent.y - playerPosition.y, 2)
            );
            return distance <= broadcastRadius;
        });
    }, [agents, playerPosition]);

    // Get all threads (from thread name map)
    const allThreads = useMemo(() => {
        return Object.keys(threadNameToIdMap).map(threadName => ({
            threadName,
            backendThreadId: threadNameToIdMap[threadName],
            agentNames: fullThreadData[threadName]?.agentNames || [], // Use stored agent names
            isActive: threadName === activeThreadId
        }));
    }, [threadNameToIdMap, activeThreadId, fullThreadData]);

    // Switch to a different thread
    const switchToThread = useCallback((threadName: string) => {
        console.log('Switching to thread:', threadName);
        setActiveThreadId(threadName);

        // Get agent names from stored data
        const agentNames = fullThreadData[threadName]?.agentNames || [];
        setThreadAgentNames(agentNames);

        // If thread already exists in map, enable SSE
        if (threadNameToIdMap[threadName]) {
            setHasStartedConversation(true);
        }

        setShowThreadList(false);
    }, [threadNameToIdMap, fullThreadData]);

    // Delete a thread
    const deleteThread = useCallback(async (threadName: string, e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent thread selection when clicking delete

        if (!address) return;

        try {
            const response = await fetch(`/api/threads?userId=${address}&threadName=${threadName}`, {
                method: 'DELETE',
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
            if (activeThreadId === threadName) {
                setActiveThreadId(undefined);
                setThreadAgentNames([]);
                setHasStartedConversation(false);
            }
        } catch (error) {
            console.error('Error deleting thread:', error);
        }
    }, [address, threadNameToIdMap, fullThreadData, activeThreadId]);

    // Update activeThreadId when prop changes (only if it's a valid thread ID)
    useEffect(() => {
        if (currentThreadId && currentThreadId !== '0' && currentThreadId !== 'undefined') {
            setActiveThreadId(currentThreadId);
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
                threadId: threadId || activeThreadId || undefined
            };

            console.log('Agent response received:', {
                agentId: agentId,
                message: message,
                threadId: agentMessage.threadId,
                activeThreadId
            });

            setMessages((prev) => [...prev, agentMessage]);

            nextAgentRequest.forEach(async (req) => {
                worldSendMessage(req, agentMessage.threadId);
            });
        }
    });

    // Handle SSE stream messages from A2A Orchestration
    const handleStreamEvent = useCallback((event: StreamEvent) => {
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
            const messageData = (eventData.data || eventData) as { speaker?: string; content?: string; id?: string };

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
                messageData.content ||
                eventData.content ||
                eventData.message ||
                JSON.stringify(eventData);

            console.log('Extracted agent name:', agentName);
            console.log('Extracted message content:', messageContent);

            // Add agent message to chat
            const agentMessage: Message = {
                id: messageData.id || `stream-${Date.now()}-${Math.random()}`,
                text: messageContent,
                timestamp: new Date(),
                sender: 'ai',
                senderId: agentName,
                threadId: activeThreadId || undefined
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
                threadId: activeThreadId || undefined
            };
            setMessages((prev) => [...prev, errorMessage]);
        }
    }, [activeThreadId, setMessages]);

    // Connect to SSE stream for current thread (only after conversation has started)
    // Use the backend thread ID from our mapping
    const backendThreadId = activeThreadId ? threadNameToIdMap[activeThreadId] : null;

    useThreadStream({
        threadId: backendThreadId || null,
        onMessage: handleStreamEvent,
        enabled: hasStartedConversation && !!backendThreadId && backendThreadId !== '0' && backendThreadId !== 'undefined'
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
            const currentAgentNames = agentsInRadius.map(a => a.name).sort();

            // Generate deterministic thread name from agent combination and user address
            const threadName = generateThreadId(currentAgentNames, address);

            console.log('Current agents in radius:', currentAgentNames);
            console.log('Generated thread name:', threadName);

            // Check if we already have a backend thread ID for this agent combination
            const existingBackendThreadId = threadNameToIdMap[threadName];

            console.log('Existing backend thread ID:', existingBackendThreadId);
            console.log('Previous active thread ID:', activeThreadId);

            // Determine which backend thread ID to use
            // If we have an existing mapping, use it; otherwise send undefined to create new
            const backendThreadIdToSend = existingBackendThreadId || undefined;

            // Check if we're switching to a different thread
            const threadChanged = threadName !== activeThreadId;

            if (threadChanged) {
                console.log('Agent combination changed - switching to thread:', threadName);
                setActiveThreadId(threadName);
                setThreadAgentNames(currentAgentNames);

                // If we're using an existing thread, we can start conversation immediately
                // If it's new, we'll wait for backend response
                if (existingBackendThreadId) {
                    setHasStartedConversation(true);
                } else {
                    setHasStartedConversation(false);
                }

                // Add system message to notify user about thread change
                if (activeThreadId) {
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
                previousThreadId: activeThreadId
            });

            setMessages((prev) => [...prev, newMessage]);
            setInputValue('');

            // Extract mentioned agents from message
            const mentionMatches = userMessageText.match(/@(\w+)/g);
            const mentionedAgents = mentionMatches?.map(m => m.substring(1)) || [];

            try {
                // Send message through A2A Orchestration API
                const response = await fetch('/api/thread-message', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        message: userMessageText,
                        playerPosition: currentPlayerPosition,
                        broadcastRadius: 10,
                        threadId: backendThreadIdToSend,
                        agentNames: currentAgentNames, // Explicitly pass the agent list calculated on frontend
                        mentionedAgents: mentionedAgents.length > 0 ? mentionedAgents : undefined
                    }),
                });

                if (!response.ok) {
                    throw new Error(`Failed to send message: ${response.statusText}`);
                }

                const result = await response.json();
                console.log('Thread message sent:', result);

                // Store the mapping between thread name and backend thread ID
                if (result.threadId) {
                    console.log('Backend thread ID:', result.threadId);

                    // Save the mapping if it's new
                    if (!threadNameToIdMap[threadName]) {
                        console.log('Saving mapping:', threadName, '→', result.threadId);

                        // Update local state
                        setThreadNameToIdMap(prev => ({
                            ...prev,
                            [threadName]: result.threadId
                        }));

                        // Update full thread data
                        setFullThreadData(prev => ({
                            ...prev,
                            [threadName]: {
                                backendThreadId: result.threadId,
                                agentNames: currentAgentNames
                            }
                        }));

                        // Save to backend
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
                            }).catch(err => console.error('Failed to save thread mapping:', err));
                        }
                    }

                    // Wait a bit for backend to fully initialize thread before connecting SSE
                    setTimeout(() => {
                        setHasStartedConversation(true);
                    }, 500);
                } else {
                    console.warn('Backend did not return thread ID');
                    // Still enable SSE
                    setTimeout(() => {
                        setHasStartedConversation(true);
                    }, 500);
                }
            } catch (error) {
                console.error('Failed to send thread message:', error);
                const errorMessage: Message = {
                    id: `error-${Date.now()}`,
                    text: `Failed to send message: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    timestamp: new Date(),
                    sender: 'system',
                    threadId: currentThreadId || undefined
                };
                setMessages((prev) => [...prev, errorMessage]);
            }
        }
    };

    // Filter messages by current thread
    const threadMessages = activeThreadId
        ? messages.filter((msg) => msg.threadId === activeThreadId)
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

        if (e.key === 'Enter') {
            e.preventDefault();
            handleSendMessage();
        }
    };

    // Handle input changes and check for @ mentions
    const handleInputChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
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

    const getAgentNameAndPosition = (senderId: string | undefined): string => {
        if (!senderId) return 'AI';
        // Try to find agent by ID first, then by name (for SSE stream messages)
        const agent = agents.find((a) => a.id === senderId || a.name === senderId);
        if (agent && playerPosition) {
            const distance = Math.sqrt(
                Math.pow(agent.x - playerPosition.x, 2) + Math.pow(agent.y - playerPosition.y, 2)
            );
            return `${agent.name} (${agent.x}, ${agent.y}) [${distance.toFixed(1)}u]`;
        }
        // If agent not found in local agents array, just return the senderId as name
        return senderId || 'AI';
    };

    // Get current agents in radius for display
    const currentAgentsInRadius = getCurrentAgentsInRadius();
    const currentAgentNames = currentAgentsInRadius.map(a => a.name).sort();
    const previewThreadName = generateThreadId(currentAgentNames, address);

    return (
        <div className={cn('relative flex h-full w-full flex-col bg-transparent', className)}>
            {/* Thread info - Top left corner */}
            <div className="absolute top-0 left-0 z-10 p-3">
                <div className="flex items-start gap-2">
                    {/* Thread menu button */}
                    <button
                        onClick={() => setShowThreadList(!showThreadList)}
                        className="rounded-lg bg-black/60 px-3 py-2 hover:bg-black/80 transition-colors"
                    >
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-white/80">☰</span>
                            <span className="text-xs text-white/80 font-semibold">
                                {allThreads.length} Thread{allThreads.length !== 1 ? 's' : ''}
                            </span>
                        </div>
                    </button>

                    {/* Current thread info */}
                    {(activeThreadId || currentAgentNames.length > 0) && (
                        <div className="rounded-lg bg-black/60 px-3 py-2 max-w-md">
                            <div className="flex flex-col gap-1">
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-white/40">
                                        {activeThreadId ? 'Thread:' : 'Will create:'}
                                    </span>
                                    <span className="text-xs text-white/60 font-mono truncate max-w-[200px]">
                                        {activeThreadId || previewThreadName}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2 flex-wrap">
                                    {(activeThreadId ? threadAgentNames : currentAgentNames).map((name) => {
                                        const agent = agents.find(a => a.name === name);
                                        return (
                                            <div
                                                key={name}
                                                className="inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-0.5"
                                            >
                                                {agent && (
                                                    <div
                                                        className="h-2 w-2 rounded-full"
                                                        style={{ backgroundColor: agent.color }}
                                                    />
                                                )}
                                                <span className="text-xs text-white/80">{name}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Thread list dropdown */}
                {showThreadList && (
                    <div className="absolute top-full left-0 mt-2 w-96 max-h-96 overflow-y-auto rounded-lg bg-black/90 shadow-xl border border-white/10">
                        <div className="p-3">
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="text-sm font-semibold text-white">Your Conversations</h3>
                                <button
                                    onClick={() => setShowThreadList(false)}
                                    className="text-white/60 hover:text-white text-xs"
                                >
                                    ✕
                                </button>
                            </div>
                            {allThreads.length === 0 ? (
                                <p className="text-xs text-white/40 text-center py-4">
                                    No conversations yet. Start chatting with agents nearby!
                                </p>
                            ) : (
                                <div className="space-y-2">
                                    {allThreads.map((thread) => (
                                        <div
                                            key={thread.threadName}
                                            className={cn(
                                                'relative group w-full text-left p-3 rounded-lg transition-colors',
                                                thread.isActive
                                                    ? 'bg-white/20 border border-white/30'
                                                    : 'bg-white/5 hover:bg-white/10 border border-transparent'
                                            )}
                                        >
                                            <button
                                                onClick={() => switchToThread(thread.threadName)}
                                                className="w-full text-left"
                                            >
                                                <div className="flex flex-col gap-1 pr-8">
                                                    <div className="text-xs text-white/60 font-mono truncate">
                                                        {thread.threadName}
                                                    </div>
                                                    <div className="flex items-center gap-1 flex-wrap">
                                                        {thread.agentNames.map((name) => (
                                                            <span
                                                                key={name}
                                                                className="text-xs text-white/80 bg-white/10 px-2 py-0.5 rounded"
                                                            >
                                                                {name}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            </button>
                                            <button
                                                onClick={(e) => deleteThread(thread.threadName, e)}
                                                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-white/40 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors opacity-0 group-hover:opacity-100"
                                                title="Delete thread"
                                            >
                                                🗑️
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            <div className="h-full space-y-2 overflow-y-auto p-3 pb-20 pt-24">
                {threadMessages.slice().map((message) => (
                    <div key={message.id} className={cn('flex flex-col items-start gap-1')}>
                        <div className="flex flex-row items-center gap-2">
                            <span
                                style={{
                                    color:
                                        message.sender === 'user'
                                            ? 'white'
                                            : agents.find((a) => a.id === message.senderId || a.name === message.senderId)?.color ||
                                              'oklch(62.7% 0.194 149.214)'
                                }}
                                className="text-xs font-semibold"
                            >
                                {message.sender === 'user'
                                    ? `${shortAddress(message.senderId || '')}`
                                    : getAgentNameAndPosition(message.senderId)}
                            </span>
                            {message.sender === 'user' ? (
                                <div className="inline-flex flex-col items-start justify-center gap-2 rounded-lg bg-[#7f4fe8]/50 px-2 py-0.5">
                                    <p className="justify-start text-xs leading-5 font-normal text-[#eae0ff]">Me</p>
                                </div>
                            ) : (
                                <div className="Ta inline-flex flex-col items-start justify-center gap-2 rounded-lg bg-[#4a5057] px-2 py-0.5">
                                    <p className="justify-start text-xs leading-5 font-normal text-[#dfe2e6]">AI</p>
                                </div>
                            )}
                        </div>
                        <div
                            className={cn(
                                'max-w-[85%] rounded-lg px-3 py-2 text-sm',
                                message.sender === 'user'
                                    ? 'rounded-br-sm text-white'
                                    : message.sender === 'ai'
                                      ? 'rounded-bl-sm text-white'
                                      : 'rounded-bl-sm bg-gray-200 text-gray-800'
                            )}
                        >
                            <p className="justify-start text-base leading-[25px] break-words text-white">
                                {message.text}
                            </p>
                        </div>
                    </div>
                ))}
                <div ref={messagesEndRef} />
            </div>

            <div className="fixed right-0 bottom-0 left-0 bg-gradient-to-t from-black/90 to-transparent p-3 backdrop-blur-sm">

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

                <div className="my-auto inline-flex w-full items-center justify-start gap-2.5 rounded-[10px] px-2.5 py-2 outline-1 outline-offset-[-1px] outline-white">
                    <input
                        ref={inputRef}
                        type="text"
                        value={inputValue}
                        onChange={handleInputChange}
                        onKeyDown={handleKeyPress}
                        autoFocus={true}
                        placeholder="Typing Message..."
                        className="flex-1 bg-transparent text-base leading-tight text-white placeholder-white/40 focus:outline-none"
                    />
                    <button
                        onClick={handleSendMessage}
                        disabled={!inputValue.trim()}
                        className={cn(
                            'relative h-[30px] w-[30px] cursor-pointer overflow-hidden rounded-lg transition-all',
                            inputValue.trim() ? 'bg-white' : 'bg-white/30'
                        )}
                    >
                        <Image src="/footer/bottomSheet/send.svg" alt="Send" width={30} height={30} />
                    </button>
                </div>
            </div>
        </div>
    );
});

export default ChatBox;
