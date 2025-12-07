import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import ChatBox, { ChatBoxRef } from './ChatBox';
import { AgentState } from '@/lib/agent';
import { cn } from '@/lib/utils';
import { useKeyboardOpen } from '@/hooks/useKeyboardOpen';
import { Z_INDEX_OFFSETS } from '@/constants/common';
import { useState, useEffect } from 'react';

interface ChatBottomDrawerProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    openThreadList: () => void;
    chatBoxRef: React.RefObject<ChatBoxRef>;
    lastCommentary?: string;
    onThreadSelect: (threadId: string | undefined) => void;
    currentAgentsInRadius: AgentState[];
}

export default function ChatBottomDrawer({
    open,
    onOpenChange,
    openThreadList,
    chatBoxRef,
    lastCommentary,
    onThreadSelect,
    currentAgentsInRadius,
  }: ChatBottomDrawerProps) {
    const { isKeyboardOpen, remountKey } = useKeyboardOpen();
    const [viewportHeight, setViewportHeight] = useState(0);

    useEffect(() => {
        if (typeof window === 'undefined') return;

        const updateHeight = () => {
            setViewportHeight(window.innerHeight);
        };

        // 초기 높이 설정
        updateHeight();

        // resize 이벤트로 높이 추적
        window.addEventListener('resize', updateHeight);

        return () => {
            window.removeEventListener('resize', updateHeight);
        };
    }, []);
    
    return (
        <Drawer open={open} onOpenChange={onOpenChange} direction="bottom" >
            <DrawerContent
                key={remountKey} 
                className={
                    cn(
                        isKeyboardOpen ? "pb-0" : "pb-[73px]",
                        "bg-black/50",
                    )
                }
                style={{ 
                    zIndex: Z_INDEX_OFFSETS.UI + 1,
                    height: viewportHeight > 0 ? `${viewportHeight - 73}px` : 'calc(100dvh - 73px)',
                    maxHeight: viewportHeight > 0 ? `${viewportHeight - 73}px` : 'calc(100dvh - 73px)'
                }}
            >
                <DrawerHeader hidden>
                    <DrawerTitle />
                </DrawerHeader>
                <ChatBox
                      ref={chatBoxRef}
                      aiCommentary={lastCommentary}
                      onThreadSelect={onThreadSelect}
                      openThreadList={openThreadList}
                      currentAgentsInRadius={currentAgentsInRadius}
                />
            </DrawerContent>
        </Drawer>
    );
}
