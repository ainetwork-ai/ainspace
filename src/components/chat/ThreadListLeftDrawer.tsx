import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { cn } from '@/lib/utils';
import { Thread } from '@/stores';
import ThreadCard from '@/components/chat/ThreadCard';
import { Spinner } from '@/components/ui/spinner';
import { useThreadStore } from '@/stores';
import { useEffect, useState } from 'react';
import { Z_INDEX_OFFSETS } from '@/constants/common';

interface ThreadListLeftDrawerProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onThreadSelect: (threadId: string) => void;
    isLoading?: boolean;
}

export default function ThreadListLeftDrawer({
    open,
    onOpenChange,
    onThreadSelect,
    isLoading = false
}: ThreadListLeftDrawerProps) {
    const { threads } = useThreadStore();

    const [displayedThreads, setDisplayedThreads] = useState<Thread[]>([]);
    useEffect(() => {
        setDisplayedThreads(
            threads.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())
        );
    }, [threads]);

    return (
        <Drawer open={open} onOpenChange={onOpenChange} direction="left">
            <DrawerContent
                className={cn('min-h-screen w-full overflow-y-auto scrollbar-hide touch-pan-y', 'bg-[#1A1D22]')}
                style={{ zIndex: Z_INDEX_OFFSETS.UI + 2, touchAction: 'pan-y' }}
            >
                <DrawerHeader>
                    <DrawerTitle />
                </DrawerHeader>
                <div className="flex w-full flex-col">
                    {isLoading && (
                        <div className="flex w-full items-center justify-center gap-2 py-4 text-sm text-white/70">
                            <Spinner className="h-4 w-4 text-white/70" />
                            Loading threads...
                        </div>
                    )}
                    {displayedThreads.map((thread) => (
                        <ThreadCard key={thread.id} thread={thread} onThreadSelect={onThreadSelect} />
                    ))}
                </div>
            </DrawerContent>
        </Drawer>
    );
}
