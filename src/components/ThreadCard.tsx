import { UserThread, useThreadStore } from "@/stores/useThreadStore";

interface ThreadCardProps {
    thread: UserThread;
}

export default function ThreadCard({ thread }: ThreadCardProps) {
    const { setCurrentThreadId } = useThreadStore();

    const handleClick = () => {
        console.log('Setting current thread ID to:', thread.backendThreadId);
        setCurrentThreadId(thread.backendThreadId);
    }

    return (
        <div className='flex flex-col w-full px-5 py-4 gap-1.5' onClick={handleClick}>
            <p className='font-[510] text-[14px] leading-[20px] text-white' >{thread.agentNames.join(', ')}</p>
            <p className='font-normal text-[13px] leading-[20px] text-white/60' >{thread.lastMessageAt}</p>
        </div>
    );
}
