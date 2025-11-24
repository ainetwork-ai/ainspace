import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { cn } from '@/lib/utils';
import { UserThread } from '@/stores/useThreadStore';
import ThreadCard from './ThreadCard';

interface ThreadListLeftDrawerProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onThreadSelect: (threadId: string) => void;
    threads: { [threadName: string]: UserThread };
}

export default function ThreadListLeftDrawer({ open, onOpenChange, threads }: ThreadListLeftDrawerProps) {
    return (
        <Drawer open={open} onOpenChange={onOpenChange} direction="left">
            <DrawerContent
                className={
                    cn(
                        "min-h-screen w-full overflow-y-auto",
                        "bg-[#1A1D22]",
                    )
                }
            >
                <DrawerHeader>
                    <DrawerTitle />
                </DrawerHeader>
                <div className='flex flex-col w-full'>
                  {Object.values(threads).map((thread) => (
                      <ThreadCard key={thread.threadName} thread={thread} />
                  ))}
                </div>
            </DrawerContent>
        </Drawer>
    );
}