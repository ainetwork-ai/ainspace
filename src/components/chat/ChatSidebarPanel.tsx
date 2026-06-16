'use client';

import Image from 'next/image';
import React, { useEffect, useRef, useState } from 'react';
import { useThreadStore, useUserStore } from '@/stores';
import { useNearbyAgents } from '@/hooks/useNearbyAgents';
import { Thread } from '@/types/thread';
import { generateAgentComboId } from '@/lib/hash';
import { bffAuthFetch } from '@/lib/backend/bff-fetch';
import ChatBox, { ChatBoxRef } from './ChatBox';
import { ChatStreamErrorBoundary } from './ChatStreamErrorBoundary';
import ThreadListLeftDrawer from './ThreadListLeftDrawer';

export default function ChatSidebarPanel() {
    const [isThreadListLoading, setIsThreadListLoading] = useState(false);
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);
    const { setThreads, setCurrentThreadId, currentThreadId } = useThreadStore();
    const { address, sessionId, isBackendAuthed, isKioskSession } = useUserStore();
    const chatBoxRef = useRef<ChatBoxRef>(null);
    const userId = address || sessionId;

    // Load threads
    useEffect(() => {
        // EPIC14: gate on backend auth (token issuance is async after wallet
        // connect). Without this gate, the fetch fires before the JWT lands in
        // localStorage and the BFF returns an empty list.
        if (!isBackendAuthed) return;
        // EPIC18: kiosk shares one backend account — keep the thread list
        // local-only so prior visitors' conversations never repopulate it.
        if (isKioskSession) return;

        const loadThreadMappings = async () => {
            setIsThreadListLoading(true);
            try {
                const response = await bffAuthFetch('/api/threads');
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
    }, [isBackendAuthed, isKioskSession, userId, setThreads]);

    const nearbyAgents = useNearbyAgents();
    const [isChatLoading, setIsChatLoading] = useState(false);
    const shouldShowEmptyState = (!currentThreadId || currentThreadId === '0') && !isChatLoading;

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
                <div className={shouldShowEmptyState ? 'flex flex-1 items-center justify-center flex-col gap-4 min-h-0 overflow-hidden' : 'hidden'}>
                    {nearbyAgents.length === 0 ? (
                      <div className="flex flex-col items-center justify-center">
                          <Image src="/chat/chat_bg_no_agent.svg" alt="Empty State" width={180} height={180} />
                          <p className="text-white text-center font-semibold leading-[160%] whitespace-pre-line">
                              {'Walk around the village and\nmeet the agents who live here!'}
                          </p>
                        </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center">
                          <Image src="/chat/chat_bg_nearby_agent.svg" alt="Nearby Agent" width={180} height={180} />
                          <div className="text-white text-center font-semibold leading-[160%] whitespace-pre-line">
                              <p>Try talking to</p>
                              <p className="text-[#FFE500] text-xl font-semibold">
                                  {nearbyAgents.map(a => a.name).join(', ')}
                              </p>
                              <p>nearby.</p>
                          </div>
                      </div>
                    )}
                </div>
                <div className={shouldShowEmptyState ? '' : 'flex-1 min-h-0'}>
                    <ChatStreamErrorBoundary resetKey={currentThreadId}>
                        <ChatBox
                            ref={chatBoxRef}
                            openThreadList={openDrawer}
                            onLoadingChange={setIsChatLoading}
                        />
                    </ChatStreamErrorBoundary>
                </div>
            </div>
        </div>
    );
}
