import { useThreadStore } from '@/stores/useThreadStore';
import { Thread } from '@/types/thread';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from './ui/context-menu';
import { Trash2Icon } from 'lucide-react';
import { useAccount } from 'wagmi';

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
    }

    return (
        <ContextMenu>
            <ContextMenuTrigger>
                <div className="flex w-full flex-col gap-1.5 px-5 py-4" onClick={handleClick}>
                    <p className="text-[14px] leading-[20px] font-[510] text-white">{thread.agentNames.join(', ')}</p>
                    <p className="text-[13px] leading-[20px] font-normal text-white/60">{thread.lastMessageAt}</p>
                </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="bg-[#403E47]">
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
