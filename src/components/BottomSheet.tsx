import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import ChatBox, { ChatBoxRef } from './ChatBox';
import { AgentInformation } from '@/stores';
import { cn } from '@/lib/utils';

interface BottomSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
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

export default function BottomSheet({
    open,
    onOpenChange,
    chatBoxRef,
    lastCommentary,
    worldAgents,
    currentThreadId,
    threads,
    onThreadSelect,
    userId,
}: BottomSheetProps) {
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
                <DrawerHeader>
                    <DrawerTitle />
                </DrawerHeader>
                <ChatBox
                      ref={chatBoxRef}
                      className="h-screen"
                      aiCommentary={lastCommentary}
                      agents={worldAgents}
                      currentThreadId={currentThreadId}
                      threads={threads}
                      onThreadSelect={onThreadSelect}
                      userId={userId}
                />
            </DrawerContent>
        </Drawer>
    );
}
