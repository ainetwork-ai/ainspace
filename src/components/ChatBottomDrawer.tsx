import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import ChatBox, { ChatBoxRef } from './ChatBox';
import { AgentState } from '@/lib/agent';
import { cn } from '@/lib/utils';
import { useKeyboardOpen } from '@/hooks/useKeyboardOpen';

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
    const isKeyboardOpen = useKeyboardOpen();
    
    return (
        <Drawer open={open} onOpenChange={onOpenChange} direction="bottom" >
            <DrawerContent 
                className={
                    cn(
                        "h-dvh max-h-[calc(100dvh-73px)] z-49",
                        isKeyboardOpen ? "pb-0" : "pb-[73px]",
                        "bg-black/50",
                    )
                }
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
