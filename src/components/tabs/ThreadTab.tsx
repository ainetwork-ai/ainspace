'use client';

import React from 'react';
import ChatBox, { ChatBoxRef } from '@/components/ChatBox';
import BaseTabContent from './BaseTabContent';

interface ThreadTabProps {
    isActive: boolean;
    chatBoxRef: React.RefObject<ChatBoxRef | null>;
    lastCommentary: string;
    worldAgents: Array<{
        id: string;
        x: number;
        y: number;
        color: string;
        name: string;
        behavior: string;
    }>;
    currentThreadId?: string;
    threads: {
        id: string;
        message: string;
        timestamp: Date;
        agentsReached: number;
        agentNames: string[];
    }[];
    onThreadSelect: (threadId: string | undefined) => void;
    onResetLocation?: () => void;
    userId?: string | null;
}

export default function ThreadTab({
    isActive,
    chatBoxRef,
    lastCommentary,
    worldAgents,
    currentThreadId,
    threads,
    onThreadSelect,
    onResetLocation,
    userId
}: ThreadTabProps) {
    // FIXME(yoojin): unused tab. need to remove
    return (
        <BaseTabContent isActive={isActive} withPadding={false}>
            <ChatBox
                ref={chatBoxRef}
                className="h-screen"
                aiCommentary={lastCommentary}
                agents={worldAgents}
                onThreadSelect={onThreadSelect}
                onResetLocation={onResetLocation}
                openThreadList={() => {}}
            />
        </BaseTabContent>
    );
}
