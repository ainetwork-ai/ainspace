import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import ChatBox, { ChatBoxRef } from './ChatBox';
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
}

export default function ChatBottomDrawer({
    open,
    onOpenChange,
    openThreadList,
    chatBoxRef,
    lastCommentary,
    onThreadSelect,
  }: ChatBottomDrawerProps) {
    const { isKeyboardOpen, keyboardGap, visibleHeight } = useKeyboardOpen();

    const style: React.CSSProperties = isKeyboardOpen
        ? {
            zIndex: Z_INDEX_OFFSETS.UI + 1,
            bottom: `${keyboardGap}px`,
            height: `${visibleHeight}px`,
          }
        : { zIndex: Z_INDEX_OFFSETS.UI + 1 };

    return (
        <Drawer open={open} onOpenChange={onOpenChange} direction="bottom" >
            <DrawerContent
                className={
                    cn(
                        !isKeyboardOpen && "h-[calc(100vh-73px)]",
                        isKeyboardOpen ? "pb-0" : "pb-[73px]",
                        "bg-black/50",
                    )
                }
                style={style}
            >
                <DrawerHeader hidden>
                    <DrawerTitle />
                </DrawerHeader>
                <ChatBox
                      ref={chatBoxRef}
                      aiCommentary={lastCommentary}
                      onThreadSelect={onThreadSelect}
                      openThreadList={openThreadList}
                />
            </DrawerContent>
        </Drawer>
    );
}
