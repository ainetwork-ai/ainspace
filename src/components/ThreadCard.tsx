import { useThreadStore } from '@/stores/useThreadStore';
import { Thread } from '@/types/thread';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from './ui/context-menu';
import { AlertTriangle, Trash2Icon } from 'lucide-react';
import { useAccount } from 'wagmi';
import { Z_INDEX_OFFSETS } from '@/constants/common';

interface ThreadCardProps {
    thread: Thread;
    onThreadSelect: (threadId: string) => void;
}

export default function ThreadCard({ thread, onThreadSelect }: ThreadCardProps) {
    const { address } = useAccount();
    const { removeThread } = useThreadStore();

    const deleteThread = async (e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent thread selection when clicking delete

        if (!address) return;

        try {
            const response = await fetch(`/api/threads/${thread.id}?userId=${address}`, {
                method: 'DELETE'
            });

            if (!response.ok) {
                console.error('Failed to delete thread');
                return;
            }

            removeThread(thread.id);
            console.log('Thread deleted:', thread.id);
        } catch (error) {
            console.error('Error deleting thread:', error);
        }
    };
    const handleClick = () => {
        console.log('Setting current thread ID to:', thread.id);
        onThreadSelect(thread.id);
    };

    return (
        <ContextMenu>
            <ContextMenuTrigger>
                <div
                    className="flex w-full flex-col gap-1.5 px-5 py-4"
                    style={{ zIndex: Z_INDEX_OFFSETS.UI + 3 }}
                    onClick={handleClick}
                >
                    <div className="flex items-center gap-1.5">
                        <p className="text-[14px] leading-[20px] font-[510] text-white">
                            {thread.agentNames.join(', ')}
                        </p>
                        {thread.hasUnplacedAgents && <AlertTriangle className="h-4 w-4 text-[#FFB020]" />}
                    </div>
                    <p className="text-[13px] leading-[20px] font-normal text-white/60">{thread.lastMessageAt}</p>
                </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="bg-[#403E47]" style={{ zIndex: Z_INDEX_OFFSETS.UI + 4 }}>
                <ContextMenuItem
                    className="flex justify-between text-[#FF552D]"
                    variant="destructive"
                    onClick={deleteThread}
                >
                    Delete
                    <Trash2Icon className="text-[#FF552D]" />
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    );
}
