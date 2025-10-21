import { create } from 'zustand';

export interface Thread {
    id: string;
    message: string;
    timestamp: Date;
    agentsReached: number;
    agentNames: string[];
}

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
    addThread: (thread: Thread) => void;
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

    addThread: (thread) => set((state) => ({ threads: [thread, ...state.threads] })),
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
