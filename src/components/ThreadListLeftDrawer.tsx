import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { cn } from '@/lib/utils';
import { Thread } from '@/types/thread';
import ThreadCard from './ThreadCard';
import { useThreadStore } from '@/stores';
import { useEffect, useState } from 'react';

interface ThreadListLeftDrawerProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onThreadSelect: (threadId: string) => void;
}

export default function ThreadListLeftDrawer({ open, onOpenChange, onThreadSelect }: ThreadListLeftDrawerProps) {
    const { threads } = useThreadStore();

    const [displayedThreads, setDisplayedThreads] = useState<Thread[]>([]);
    useEffect(() => {
        setDisplayedThreads(threads.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()));
    }, [threads]);

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
                  {displayedThreads.map((thread) => (
                      <ThreadCard key={thread.id} thread={thread} onThreadSelect={onThreadSelect} />
                  ))}
                </div>
            </DrawerContent>
        </Drawer>
    );
}