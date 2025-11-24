import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import ChatBox, { ChatBoxRef } from './ChatBox';
import { AgentInformation } from '@/stores';
import { cn } from '@/lib/utils';

interface ChatBottomDrawerProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    openThreadList: () => void;
    chatBoxRef: React.RefObject<ChatBoxRef>;
    lastCommentary: string;
    worldAgents: AgentInformation[];
    currentThreadId: string | undefined;
    threads: {
        id: string;
        message: string;
        timestamp: Date;
        agentsReached: number;
        agentNames: string[];
    }[];
    onThreadSelect: (threadId: string | undefined) => void;
    userId: string | null;
}

export default function ChatBottomDrawer({
    open,
    onOpenChange,
    openThreadList,
    chatBoxRef,
    lastCommentary,
    worldAgents,
    currentThreadId,
    threads,
    onThreadSelect,
    userId,
  }: ChatBottomDrawerProps) {
    return (
        <Drawer open={open} onOpenChange={onOpenChange} direction="bottom" >
            <DrawerContent 
                className={
                    cn(
                        "h-screen max-h-screen z-49 pb-[73px]",
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
                      agents={worldAgents}
                      currentThreadId={currentThreadId}
                      threads={threads}
                      onThreadSelect={onThreadSelect}
                      userId={userId}
                      openThreadList={openThreadList}
                />
            </DrawerContent>
        </Drawer>
    );
}
