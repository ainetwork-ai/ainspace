'use client';

import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { useWorld } from '@/hooks/useWorld';
import { Agent, AgentResponse } from '@/lib/world';
import { cn } from '@/lib/utils';
import Image from 'next/image';
import { useBuildStore, useGameStateStore } from '@/stores';
import { useSession } from '@/hooks/useSession';

interface Message {
    id: string;
    text: string;
    timestamp: Date;
    sender: 'user' | 'system' | 'ai';
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
    const [messages, setMessages] = useState<Message[]>([]);
    const [inputValue, setInputValue] = useState('');
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [filteredAgents, setFilteredAgents] = useState<Agent[]>([]);
    const [cursorPosition, setCursorPosition] = useState(0);
    const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
    const { showCollisionMap, setShowCollisionMap, updateCollisionMapFromImage, publishedTiles, setCollisionMap } = useBuildStore();
    const inputRef = useRef<HTMLInputElement>(null);

    const { userId } = useSession();
    const { worldPosition: playerPosition } = useGameStateStore();

    // Initialize world system
    const { sendMessage: worldSendMessage, getAgentSuggestions, playDemoScenario } = useWorld({
        agents: agents || [],
        playerPosition: playerPosition || { x: 0, y: 0 },
        onAgentResponse: (response: AgentResponse & { threadId?: string }) => {
            const { agentId, message, threadId, nextAgentRequest } = response;
            // Add agent response to chat with thread ID
            const agentMessage: Message = {
                id: `agent-${agentId}-${Date.now()}`,
                text: message,
                timestamp: new Date(),
                sender: 'ai',
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
    //                 threadId: threadId || currentThreadId || undefined
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

    // Add welcome message on client side only to avoid hydration mismatch
    useEffect(() => {
        setMessages((prev) => {
            if (prev.length === 0) {
                return [
                    {
                        id: '1',
                        text: 'Welcome to the Tile Map Game! Use arrow keys to move around.',
                        timestamp: new Date(),
                        sender: 'system',
                        threadId: undefined
                    }
                ];
            }
            return prev;
        });
    }, []);

    // Add AI commentary to messages when it changes
    useEffect(() => {
        if (aiCommentary && aiCommentary.trim()) {
            const aiMessage: Message = {
                id: `ai-${Date.now()}`,
                text: aiCommentary,
                timestamp: new Date(),
                sender: 'ai',
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

                // Reset collision map to base land_layer_1.png only
                await updateCollisionMapFromImage('/map/land_layer_1.png');

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
                text: 'Updating collision map from land_layer_1.png and published tiles...',
                timestamp: new Date(),
                sender: 'system',
                threadId: undefined
            };
            setMessages((prev) => [...prev, systemMessage]);

            try {
                // Step 1: Update collision map from land_layer_1.png image
                await updateCollisionMapFromImage('/map/land_layer_1.png');

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
        }  else if (inputValue.trim() === 'I’m literally starving. What’s the move for lunch?') {
          console.log('demo start');
          const newMessage: Message = {
            id: Date.now().toString(),
            text: inputValue.trim(),
            timestamp: new Date(),
            sender: 'user',
            threadId: currentThreadId || undefined
          };
          setMessages((prev) => [...prev, newMessage]);
          setInputValue('');

          await playDemoScenario(0, ['agent-1', 'agent-2', 'agent-3', 'agent-1']);
        } else if (inputValue.trim()) {
            const newMessage: Message = {
                id: Date.now().toString(),
                text: inputValue.trim(),
                timestamp: new Date(),
                sender: 'user',
                threadId: currentThreadId || undefined
            };

            console.log('HandleSendMessage:', {
                text: newMessage.text,
                threadId: newMessage.threadId,
                messageId: newMessage.id
            });
            const isFirstChat = messages.length === 1;

            setMessages((prev) => [...prev, newMessage]);
            const userMessageText = inputValue.trim();
            setInputValue('');

            // Send message through world system (no radius limit for regular chat)
            await worldSendMessage(userMessageText, currentThreadId || undefined, isFirstChat ? 10 : undefined);
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

    return (
        <div className={cn('flex h-full w-full flex-col bg-transparent', className)}>
            <div className="max-h-full min-h-[150px] flex-1 space-y-2 overflow-y-auto p-3">
                {threadMessages.slice().map((message) => (
                    <div key={message.id} className={cn('flex flex-col items-start gap-1')}>
                        <div className="flex flex-row items-center gap-2">
                            <Image
                                src={
                                    message.sender === 'user'
                                        ? '/footer/bottomSheet/avatar_player.png'
                                        : '/footer/bottomSheet/avatar_agent_1.png'
                                }
                                alt="User"
                                width={24}
                                height={24}
                            />
                            <span className="text-xs font-semibold text-white">
                                {message.sender === 'user' ? 'You' : 'AI'}
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
                                      ? 'rounded-bl-sm border border-green-300 bg-green-100 text-green-800'
                                      : 'rounded-bl-sm bg-gray-200 text-gray-800'
                            )}
                        >
                            {message.sender === 'ai' && (
                                <div className="mb-1 flex items-center">
                                    <span className="text-xs font-semibold text-green-600">
                                        🤖{' '}
                                        {message.id.includes('agent-')
                                            ? (() => {
                                                  const agent = agents.find((a) => message.id.includes(a.id));
                                                  if (agent && playerPosition) {
                                                      const distance = Math.sqrt(
                                                          Math.pow(agent.x - playerPosition.x, 2) +
                                                              Math.pow(agent.y - playerPosition.y, 2)
                                                      );
                                                      return `${agent.name} (${agent.x}, ${agent.y}) [${distance.toFixed(1)}u]`;
                                                  }
                                                  return agent ? `${agent.name} (${agent.x}, ${agent.y})` : 'AI Agent';
                                              })()
                                            : 'AI Explorer'}
                                    </span>
                                </div>
                            )}
                            <p className="leading-[25px]break-words justify-start text-base text-white">
                                {message.text}
                            </p>
                        </div>
                    </div>
                ))}
            </div>

            <div className="relative flex-shrink-0 bg-transparent p-3">
                {showSuggestions && filteredAgents.length > 0 && (
                    <div className="absolute right-3 bottom-full left-3 z-10 mb-1 max-h-32 overflow-y-auto rounded-md border border-gray-600 bg-gray-800 shadow-lg">
                        {filteredAgents.map((agent, index) => {
                            const distance = playerPosition
                                ? Math.sqrt(
                                      Math.pow(agent.x - playerPosition.x, 2) +
                                          Math.pow(agent.y - playerPosition.y, 2)
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
                                    <div className={cn('text-xs', isSelected ? 'text-blue-200' : 'text-gray-400')}>
                                        ({agent.x}, {agent.y}) [{distance.toFixed(1)}u]
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}

                <div className="inline-flex w-full items-center justify-start gap-2.5 rounded-[10px] px-2.5 py-2 outline-1 outline-offset-[-1px] outline-white my-auto">
                    <input
                        ref={inputRef}
                        type="text"
                        value={inputValue}
                        onChange={handleInputChange}
                        onKeyDown={handleKeyPress}
                        autoFocus={true}
                        placeholder="Typing Message..."
                        className="flex-1 bg-transparent text-sm leading-tight text-white placeholder-white/40 focus:outline-none"
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
