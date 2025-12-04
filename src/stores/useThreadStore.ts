import { create } from 'zustand';
import { Thread } from '@/types/thread';

interface BroadcastStatus {
    range: number;
    agentsReached: number;
    agentNames: string[];
}

interface ThreadState {
    threads: Thread[];
    currentThreadId: string | undefined;
    broadcastMessage: string;
    broadcastStatus: BroadcastStatus | null;

    // Actions
    setThreads: (threads: Thread[]) => void;
    addThread: (thread: Thread) => void;
    findThreadByName: (threadName: string) => Thread | undefined;
    findThreadById: (threadId: string) => Thread | undefined;
    removeThread: (threadId: string) => void;
    setCurrentThreadId: (threadId: string | undefined) => void;
    setBroadcastMessage: (message: string) => void;
    setBroadcastStatus: (status: BroadcastStatus | null) => void;
    clearBroadcastMessage: () => void;
    clearBroadcastStatusAfterDelay: (delay: number) => void;
}

export const useThreadStore = create<ThreadState>((set, get) => ({
    threads: [],
    currentThreadId: '0',
    broadcastMessage: '',
    broadcastStatus: null,

    setThreads: (threads) => set({ threads }),
    addThread: (thread) => set((state) => ({ threads: [thread, ...state.threads] })),
    findThreadByName: (threadName) => get().threads.find(thread => thread.threadName === threadName),
    findThreadById: (threadId) => get().threads.find(thread => thread.id === threadId),
    removeThread: (threadId: string) => set((state) => {
        return { threads: state.threads.filter(thread => thread.id !== threadId) }
    }),
    
    setCurrentThreadId: (threadId) => set({ currentThreadId: threadId }),
    setBroadcastMessage: (message) => set({ broadcastMessage: message }),
    setBroadcastStatus: (status) => set({ broadcastStatus: status }),
    clearBroadcastMessage: () => set({ broadcastMessage: '' }),
    clearBroadcastStatusAfterDelay: (delay) => {
        setTimeout(() => {
            set({ broadcastStatus: null });
        }, delay);
    }
}));
