import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import ChatBox, { ChatBoxRef } from './ChatBox';
import { VisibleAgent } from '@/stores';
import { cn } from '@/lib/utils';

interface ChatBottomDrawerProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    openThreadList: () => void;
    chatBoxRef: React.RefObject<ChatBoxRef>;
    lastCommentary?: string;
    worldAgents: VisibleAgent[];
    onThreadSelect: (threadId: string | undefined) => void;
}

export default function ChatBottomDrawer({
    open,
    onOpenChange,
    openThreadList,
    chatBoxRef,
    lastCommentary,
    worldAgents,
    onThreadSelect,
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
                      agents={worldAgents.map(agent => ({
                        ...agent,
                        behavior: 'random', // FIXME(yoojin): temp behavior
                      }))}
                      onThreadSelect={onThreadSelect}
                      openThreadList={openThreadList}
                />
            </DrawerContent>
        </Drawer>
    );
}
