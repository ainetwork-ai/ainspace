import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import ChatBox, { ChatBoxRef } from './ChatBox';
import { AgentState } from '@/lib/agent';
import { cn } from '@/lib/utils';
import { useKeyboardOpen } from '@/hooks/useKeyboardOpen';
import { Z_INDEX_OFFSETS } from '@/constants/common';

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
    
    return (
        <Drawer open={open} onOpenChange={onOpenChange} direction="bottom" >
            <DrawerContent
                key={remountKey} 
                className={
                    cn(
                        "h-full max-h-[calc(100dvh-73px)]",
                        isKeyboardOpen ? "pb-0" : "pb-[73px]",
                        "bg-black/50",
                    )
                }
                style={{ zIndex: Z_INDEX_OFFSETS.UI + 1 }}
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
