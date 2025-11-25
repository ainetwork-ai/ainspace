import { UserThread } from "@/stores/useThreadStore";

interface ThreadCardProps {
    thread: UserThread;
}

export default function ThreadCard({ thread }: ThreadCardProps) {
    return (
        <div className='flex flex-col w-full px-5 py-4 gap-1.5'>
            <p className='font-[510] text-[14px] leading-[20px] text-white' >{thread.agentNames.join(', ')}</p>
            <p className='font-normal text-[13px] leading-[20px] text-white/60' >{thread.lastMessageAt}</p>
        </div>
    );
} 