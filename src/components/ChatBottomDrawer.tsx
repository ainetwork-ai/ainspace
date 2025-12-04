import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import ChatBox, { ChatBoxRef } from './ChatBox';
import { AgentState } from '@/lib/agent';
import { cn } from '@/lib/utils';

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
    return (
        <Drawer open={open} onOpenChange={onOpenChange} direction="bottom" >
            <DrawerContent 
                className={
                    cn(
                        "h-dvh max-h-dvh z-49 pb-[73px]",
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
