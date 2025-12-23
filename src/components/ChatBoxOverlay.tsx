'use client';

import { cn } from '@/lib/utils';
import { useGameStateStore, useThreadStore } from '@/stores';
import { AgentState } from '@/lib/agent';
import { Triangle } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import ChatBottomDrawer from './ChatBottomDrawer';
import { ChatBoxRef } from './ChatBox';
import ThreadListLeftDrawer from './ThreadListLeftDrawer';
import { useAccount } from 'wagmi';
import { Thread } from '@/stores';
import { generateAgentComboId } from '@/lib/hash';
import { Z_INDEX_OFFSETS } from '@/constants/common';

interface ChatBoxOverlayProps {
    chatBoxRef: React.RefObject<ChatBoxRef | null>;
    setJoystickVisible: (isJoystickVisible: boolean) => void;
    className?: string;
    lastCommentary?: string;
    currentAgentsInRadius: AgentState[];
    HUDOff: boolean;
}

export default function ChatBoxOverlay({
    chatBoxRef,
    className,
    lastCommentary,
    setJoystickVisible,
    currentAgentsInRadius,
    HUDOff
}: ChatBoxOverlayProps) {
    const [isChatSheetOpen, setIsChatSheetOpen] = useState(false);
    const [isThreadListSheetOpen, setIsThreadListSheetOpen] = useState(false);
    const [isThreadListLoading, setIsThreadListLoading] = useState(false);
    const { setThreads, setCurrentThreadId } = useThreadStore();
    const { worldPosition } = useGameStateStore();

    const { address } = useAccount();

    useEffect(() => {
        if (!address) return;

        const loadThreadMappings = async () => {
            setIsThreadListLoading(true);
            try {
                const response = await fetch(`/api/threads?userId=${address}`);
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
                            unplacedAgentNames: threadData.unplacedAgentNames
                        });
                    }
                    fetchedThreads.sort(
                        (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
                    );
                    setThreads(fetchedThreads);
                    console.log('fetchedThreads', fetchedThreads);
                }
            } catch (error) {
                console.error('Error loading threads:', error);
            } finally {
                setIsThreadListLoading(false);
            }
        };

        loadThreadMappings();
    }, [address, setThreads]);

    const handleChatSheetOpen = (open: boolean) => {
        setIsChatSheetOpen(open);

        if (!open) {
            setCurrentThreadId('0');
        }
    };

    const handleThreadListSheetOpen = (open: boolean) => {
        setIsThreadListSheetOpen(open);
    };

    useEffect(() => {
        setJoystickVisible(!isChatSheetOpen && !isThreadListSheetOpen);
    }, [isChatSheetOpen, isThreadListSheetOpen, setJoystickVisible]);

    // Generate placeholder text
    const chatPlaceholder = useMemo(() => {
        const positionString = `(${worldPosition.x}, ${worldPosition.y})`;
        if (currentAgentsInRadius.length === 0) {
            return `${positionString} Talk to: No agents nearby`;
        }
        
        const agentNames = currentAgentsInRadius.map((a) => a.name).join(', ');
        return `${positionString} Talk to: ${agentNames}`;
    }, [currentAgentsInRadius, worldPosition]);

    const openChatSheet = () => {
        handleChatSheetOpen(true);
    };

    const openThreadListSheet = () => {
        handleThreadListSheetOpen(true);
    };

    const handleThreadSelect = (threadId: string) => {
        setCurrentThreadId(threadId);
        openChatSheet();
        handleThreadListSheetOpen(false);
    };

    return (
        <div className={cn('relative w-full', className)} style={{ zIndex: Z_INDEX_OFFSETS.UI }}>
            {!isChatSheetOpen && (
                <div
                    className={cn(
                        'flex w-full items-center justify-center gap-1.5 self-stretch rounded-tl-lg rounded-tr-lg bg-black/50 p-3 backdrop-blur-[6px]'
                    )}
                    hidden={HUDOff}
                >
                    <div className="rounded-full bg-black/30 p-2" onClick={openThreadListSheet}>
                        <Image
                            src="/footer/bottomTab/tab_icon_bubble.svg"
                            className="h-4 w-4"
                            alt="Chat"
                            width={16}
                            height={16}
                        />
                    </div>
                    <button
                        onClick={openChatSheet}
                        className="flex flex-1 cursor-pointer rounded-[100px] bg-black/30 px-2.5 py-2"
                    >
                        <span className="text-xs font-bold text-white">{chatPlaceholder}</span>
                    </button>
                    <button className="flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-white">
                        <Triangle className="text-xs font-bold text-black" fill="black" width={12} height={9} />
                    </button>
                </div>
            )}
            <ChatBottomDrawer
                open={isChatSheetOpen}
                onOpenChange={handleChatSheetOpen}
                openThreadList={() => handleThreadListSheetOpen(true)}
                chatBoxRef={chatBoxRef as React.RefObject<ChatBoxRef>}
                onThreadSelect={setCurrentThreadId}
                currentAgentsInRadius={currentAgentsInRadius}
            />
            <ThreadListLeftDrawer
                open={isThreadListSheetOpen}
                onOpenChange={handleThreadListSheetOpen}
                onThreadSelect={handleThreadSelect}
                isLoading={isThreadListLoading}
            />
        </div>
    );
}
