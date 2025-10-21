'use client';

import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { useWorld } from '@/hooks/useWorld';
import { Agent, AgentResponse } from '@/lib/world';

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
    playerWorldPosition?: { x: number; y: number };
    currentThreadId?: string;
    threads?: Array<{
        id: string;
        message: string;
        timestamp: Date;
        agentsReached: number;
        agentNames: string[];
    }>;
    onThreadSelect?: (threadId: string) => void;
}

export interface ChatBoxRef {
    sendMessage: (message: string, threadId?: string, broadcastRadius?: number) => Promise<void>;
}

const ChatBox = forwardRef<ChatBoxRef, ChatBoxProps>(function ChatBox(
    { className = '', aiCommentary, agents = [], playerWorldPosition, currentThreadId, threads = [], onThreadSelect },
    ref
) {
    const [messages, setMessages] = useState<Message[]>([
        {
            id: '1',
            text: 'Welcome to the Tile Map Game! Use arrow keys to move around.',
            timestamp: new Date(),
            sender: 'system',
            threadId: undefined // Welcome message is not part of any thread
        }
    ]);
    const [inputValue, setInputValue] = useState('');
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [filteredAgents, setFilteredAgents] = useState<Agent[]>([]);
    const [cursorPosition, setCursorPosition] = useState(0);
    const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);

    // Initialize world system
    const { sendMessage: worldSendMessage, getAgentSuggestions } = useWorld({
        agents: agents || [],
        playerPosition: playerWorldPosition || { x: 0, y: 0 },
        onAgentResponse: (response: AgentResponse & { threadId?: string }) => {
            // Add agent response to chat with thread ID
            const agentMessage: Message = {
                id: `agent-${response.agentId}-${Date.now()}`,
                text: response.message,
                timestamp: new Date(),
                sender: 'ai',
                threadId: response.threadId || currentThreadId || undefined
            };

            console.log('Agent response received:', {
                agentId: response.agentId,
                message: response.message,
                threadId: agentMessage.threadId,
                currentThreadId
            });

            setMessages((prev) => [...prev, agentMessage]);
        }
    });

    // Expose sendMessage function to parent components
    useImperativeHandle(
        ref,
        () => ({
            sendMessage: async (message: string, threadId?: string, broadcastRadius?: number) => {
                const newMessage: Message = {
                    id: Date.now().toString(),
                    text: message,
                    timestamp: new Date(),
                    sender: 'user',
                    threadId: threadId || currentThreadId || undefined
                };
                console.log('SendMessage (imperative):', {
                    message,
                    threadId,
                    broadcastRadius,
                    messageId: newMessage.id
                });
                setMessages((prev) => [...prev, newMessage]);
                await worldSendMessage(message, threadId, broadcastRadius);
            }
        }),
        [worldSendMessage, currentThreadId]
    );

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
        if (inputValue.trim()) {
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
            setMessages((prev) => [...prev, newMessage]);
            const userMessageText = inputValue.trim();
            setInputValue('');

            // Send message through world system (no radius limit for regular chat)
            await worldSendMessage(userMessageText, currentThreadId || undefined);
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

    const formatTime = (date: Date) => {
        // Use consistent 24-hour format to avoid hydration mismatches
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        return `${hours}:${minutes}`;
    };

    return (
        <div className={`flex h-full w-full flex-col bg-white ${className}`}>
            {/* Chat Header */}
            <div className="flex-shrink-0 bg-blue-600 p-3 text-white">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Thread Messages</h3>
                    {threads.length > 0 && (
                        <select
                            value={currentThreadId || ''}
                            onChange={(e) => onThreadSelect?.(e.target.value)}
                            className="max-w-40 truncate rounded border border-blue-500 bg-blue-700 px-2 py-1 text-xs text-white"
                        >
                            <option value="">All Messages</option>
                            {threads.map((thread) => (
                                <option key={thread.id} value={thread.id}>
                                    {thread.message.slice(0, 20)}... ({thread.agentsReached})
                                </option>
                            ))}
                        </select>
                    )}
                </div>
                {currentThreadId && (
                    <div className="mt-1 truncate text-xs text-blue-200">
                        {(() => {
                            const thread = threads.find((t) => t.id === currentThreadId);
                            if (!thread) return '';
                            const agentNamesText =
                                thread.agentNames.length > 3
                                    ? `${thread.agentNames.slice(0, 2).join(', ')} +${thread.agentNames.length - 2} more`
                                    : thread.agentNames.join(', ');
                            return `${thread.agentsReached} agent${thread.agentsReached !== 1 ? 's' : ''}: ${agentNamesText}`;
                        })()}
                    </div>
                )}
            </div>

            {/* Input Area */}
            <div className="relative flex-shrink-0 border-b p-3">
                {/* Agent Suggestions Dropdown */}
                {showSuggestions && filteredAgents.length > 0 && (
                    <div className="absolute top-full right-3 left-3 z-10 mt-1 max-h-32 overflow-y-auto rounded-md border border-gray-300 bg-white shadow-lg">
                        {filteredAgents.map((agent, index) => {
                            const distance = playerWorldPosition
                                ? Math.sqrt(
                                      Math.pow(agent.x - playerWorldPosition.x, 2) +
                                          Math.pow(agent.y - playerWorldPosition.y, 2)
                                  )
                                : 0;

                            const isSelected = index === selectedSuggestionIndex;

                            return (
                                <button
                                    key={agent.id}
                                    onClick={() => selectSuggestion(agent)}
                                    className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm focus:outline-none ${
                                        isSelected ? 'bg-blue-100 text-blue-900' : 'text-gray-900 hover:bg-gray-100'
                                    }`}
                                >
                                    <div className="flex items-center">
                                        <div
                                            className="mr-2 h-3 w-3 rounded-sm border border-gray-400"
                                            style={{ backgroundColor: agent.color }}
                                        ></div>
                                        <span className="font-medium">{agent.name}</span>
                                    </div>
                                    <div className={`text-xs ${isSelected ? 'text-blue-700' : 'text-gray-500'}`}>
                                        ({agent.x}, {agent.y}) [{distance.toFixed(1)}u]
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}

                <div className="flex space-x-2">
                    <input
                        ref={inputRef}
                        type="text"
                        value={inputValue}
                        onChange={handleInputChange}
                        onKeyPress={handleKeyPress}
                        placeholder="Type your message... (use @ to mention agents)"
                        className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                    <button
                        onClick={handleSendMessage}
                        disabled={!inputValue.trim()}
                        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400"
                    >
                        Send
                    </button>
                </div>
            </div>

            {/* Messages Area */}
            <div className="max-h-full min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                {threadMessages
                    .slice()
                    .reverse()
                    .map((message) => (
                        <div
                            key={message.id}
                            className={`flex flex-col ${message.sender === 'user' ? 'items-end' : 'items-start'}`}
                        >
                            <div
                                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                                    message.sender === 'user'
                                        ? 'rounded-br-sm bg-blue-600 text-white'
                                        : message.sender === 'ai'
                                          ? 'rounded-bl-sm border border-green-300 bg-green-100 text-green-800'
                                          : 'rounded-bl-sm bg-gray-200 text-gray-800'
                                }`}
                            >
                                {message.sender === 'ai' && (
                                    <div className="mb-1 flex items-center">
                                        <span className="text-xs font-semibold text-green-600">
                                            🤖{' '}
                                            {message.id.includes('agent-')
                                                ? (() => {
                                                      const agent = agents.find((a) => message.id.includes(a.id));
                                                      if (agent && playerWorldPosition) {
                                                          const distance = Math.sqrt(
                                                              Math.pow(agent.x - playerWorldPosition.x, 2) +
                                                                  Math.pow(agent.y - playerWorldPosition.y, 2)
                                                          );
                                                          return `${agent.name} (${agent.x}, ${agent.y}) [${distance.toFixed(1)}u]`;
                                                      }
                                                      return agent
                                                          ? `${agent.name} (${agent.x}, ${agent.y})`
                                                          : 'AI Agent';
                                                  })()
                                                : 'AI Explorer'}
                                        </span>
                                    </div>
                                )}
                                <p className="break-words">{message.text}</p>
                            </div>
                            <span className="mt-1 text-xs text-gray-500">{formatTime(message.timestamp)}</span>
                        </div>
                    ))}
            </div>
        </div>
    );
});

export default ChatBox;
