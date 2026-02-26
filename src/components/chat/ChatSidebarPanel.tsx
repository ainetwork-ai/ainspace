'use client';

import Image from 'next/image';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useThreadStore, useUserStore, useAgentStore, useGameStateStore } from '@/stores';
import { Thread } from '@/types/thread';
import { generateAgentComboId } from '@/lib/hash';
import { BROADCAST_RADIUS } from '@/constants/game';
import ChatBox, { ChatBoxRef } from './ChatBox';
import ThreadListLeftDrawer from './ThreadListLeftDrawer';

export default function ChatSidebarPanel() {
    const [isThreadListLoading, setIsThreadListLoading] = useState(false);
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);
    const { setThreads, setCurrentThreadId, currentThreadId } = useThreadStore();
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
                    for (const [, threadData] of Object.entries(_threads)) {
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

    const nearbyAgents = currentAgentsInRadius();
    const shouldShowEmptyState = !currentThreadId || currentThreadId === '0';

    const handleThreadSelect = (threadId: string) => {
        setCurrentThreadId(threadId);
        setIsDrawerOpen(false);
    };

    const openDrawer = () => {
        setIsDrawerOpen(true);
    };

    return (
        <div className="flex h-full min-h-0 flex-col bg-[#2F333B]">
            <ThreadListLeftDrawer
                open={isDrawerOpen}
                onOpenChange={setIsDrawerOpen}
                onThreadSelect={handleThreadSelect}
                isLoading={isThreadListLoading}
            />

            {/* Content area */}
            <div className="flex flex-1 flex-col min-h-0">
                {shouldShowEmptyState && (
                    <div className="flex flex-1 items-center justify-center flex-col gap-4 min-h-0 overflow-hidden">
                        {nearbyAgents.length === 0 ? (
                          <div className="flex flex-col items-center justify-center">
                              <Image src="/chat/chat_bg_no_agent.svg" alt="Empty State" width={180} height={180} />
                              <p className="text-white text-center font-semibold leading-[160%] whitespace-pre-line">
                                  {'Walk around the village and\nmeet the agents who live here!'}
                              </p>
                            </div>
                        ) : (
                          <div className="flex flex-col items-center justify-center">
                              <div className="text-white text-center font-semibold leading-[160%] whitespace-pre-line">
                                  <Image src="/chat/chat_bg_nearby_agent.svg" alt="Nearby Agent" width={180} height={180} />
                                  <p>Try talking to</p>
                                  <p className="text-[#FFE500] text-xl font-semibold">
                                      {nearbyAgents.map(a => a.name).join(', ')}
                                  </p>
                                  <p>nearby.</p>
                              </div>
                          </div>
                        )}
                    </div>
                )}
                <div className={shouldShowEmptyState ? '' : 'flex-1 min-h-0'}>
                    <ChatBox
                        ref={chatBoxRef}
                        openThreadList={openDrawer}
                        currentAgentsInRadius={nearbyAgents}
                    />
                </div>
            </div>
        </div>
    );
}
