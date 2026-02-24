'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useThreadStore, useUserStore, useAgentStore, useGameStateStore } from '@/stores';
import { Thread } from '@/types/thread';
import { generateAgentComboId } from '@/lib/hash';
import { BROADCAST_RADIUS } from '@/constants/game';
import ChatBox, { ChatBoxRef } from './ChatBox';
import ThreadCard from './ThreadCard';
import { Spinner } from '@/components/ui/spinner';
import Image from 'next/image';
import { cn } from '@/lib/utils';

export default function ChatSidebarPanel() {
    const [isThreadListLoading, setIsThreadListLoading] = useState(false);
    const [showThreadList, setShowThreadList] = useState(false);
    const { threads, setThreads, setCurrentThreadId, currentThreadId } = useThreadStore();
    const { address, sessionId } = useUserStore();
    const agents = useAgentStore((s) => s.agents);
    const { worldPosition } = useGameStateStore();
    const chatBoxRef = useRef<ChatBoxRef>(null);
    const userId = address || sessionId;

    // Load threads
    useEffect(() => {
        if (!userId) return;

        const loadThreadMappings = async () => {
            setIsThreadListLoading(true);
            try {
                const response = await fetch(`/api/threads?userId=${userId}`);
                if (!response.ok) {
                    console.error('Failed to load threads');
                    return;
                }

                const data = await response.json();
                if (data.success && data.threads) {
                    const _threads = data.threads as { [id: string]: Thread };
                    const fetchedThreads: Thread[] = [];
                    for (const [id, threadData] of Object.entries(_threads)) {
                        const agentComboId =
                            threadData.agentComboId || (await generateAgentComboId(threadData.agentNames));
                        fetchedThreads.push({
                            id: threadData.id,
                            threadName: threadData.threadName,
                            agentNames: threadData.agentNames,
                            agentComboId,
                            createdAt: threadData.createdAt,
                            lastMessageAt: threadData.lastMessageAt,
                            hasUnplacedAgents: threadData.hasUnplacedAgents,
                            unplacedAgentNames: threadData.unplacedAgentNames,
                        });
                    }
                    fetchedThreads.sort(
                        (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
                    );
                    setThreads(fetchedThreads);
                }
            } catch (error) {
                console.error('Error loading threads:', error);
            } finally {
                setIsThreadListLoading(false);
            }
        };

        loadThreadMappings();
    }, [userId, setThreads]);

    // Agents in radius
    const currentAgentsInRadius = useCallback(() => {
        if (!worldPosition) return [];
        return agents.filter((agent) => {
            const distance = Math.sqrt(
                Math.pow(agent.x - worldPosition.x, 2) + Math.pow(agent.y - worldPosition.y, 2)
            );
            return distance <= BROADCAST_RADIUS;
        });
    }, [agents, worldPosition]);

    const handleThreadSelect = (threadId: string) => {
        setCurrentThreadId(threadId);
        setShowThreadList(false);
    };

    const toggleThreadList = () => {
        setShowThreadList((prev) => !prev);
    };

    return (
        <div className="flex h-full min-h-0 flex-col bg-[#2F333B]">
            {/* Thread list header/toggle */}
            <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
                <button
                    onClick={toggleThreadList}
                    className={cn(
                        'rounded-full p-2 transition-colors',
                        showThreadList ? 'bg-white/20' : 'bg-black/30 hover:bg-white/10'
                    )}
                >
                    <Image
                        src="/footer/bottomTab/tab_icon_bubble.svg"
                        className="h-4 w-4"
                        alt="Threads"
                        width={16}
                        height={16}
                    />
                </button>
                <span className="text-sm font-bold text-white">
                    {showThreadList ? 'Threads' : (
                        currentThreadId && currentThreadId !== '0'
                            ? threads.find(t => t.id === currentThreadId)?.agentNames.join(', ') || 'Chat'
                            : 'Chat'
                    )}
                </span>
            </div>

            {/* Content area */}
            <div className="flex flex-1 flex-col min-h-0">
                {showThreadList ? (
                    // Thread list
                    <div className="flex-1 overflow-y-auto">
                        {isThreadListLoading ? (
                            <div className="flex items-center justify-center py-8">
                                <Spinner className="size-6 text-white" />
                            </div>
                        ) : threads.length === 0 ? (
                            <div className="flex items-center justify-center py-8">
                                <p className="text-sm text-white/50">No threads yet</p>
                            </div>
                        ) : (
                            threads.map((thread) => (
                                <ThreadCard
                                    key={thread.id}
                                    thread={thread}
                                    onThreadSelect={handleThreadSelect}
                                />
                            ))
                        )}
                    </div>
                ) : (
                    // ChatBox inline
                    <ChatBox
                        ref={chatBoxRef}
                        openThreadList={toggleThreadList}
                        currentAgentsInRadius={currentAgentsInRadius()}
                    />
                )}
            </div>
        </div>
    );
}
