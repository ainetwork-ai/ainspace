import { create } from 'zustand';

export interface Thread {
    id: string;
    message: string;
    timestamp: Date;
    agentsReached: number;
    agentNames: string[];
}

export interface UserThread {
  threadName: string;
  backendThreadId: string;
  agentNames: string[];
  createdAt: string;
  lastMessageAt: string;
}

interface BroadcastStatus {
    range: number;
    agentsReached: number;
    agentNames: string[];
}

interface ThreadState {
    threads: Thread[];
    userThreads: {
      [threadName: string]: UserThread;
    };
    currentThreadId: string | undefined;
    broadcastMessage: string;
    broadcastStatus: BroadcastStatus | null;

    // Actions
    setThreads: (threads: Thread[]) => void;
    addThread: (thread: Thread) => void;
    setUserThreads: (threads: { [threadName: string]: UserThread }) => void;
    removeUserThread: (threadName: string) => void;
    setCurrentThreadId: (threadId: string | undefined) => void;
    setBroadcastMessage: (message: string) => void;
    setBroadcastStatus: (status: BroadcastStatus | null) => void;
    clearBroadcastMessage: () => void;
    clearBroadcastStatusAfterDelay: (delay: number) => void;
}

export const useThreadStore = create<ThreadState>((set, get) => ({
    threads: [],
    userThreads: {},
    currentThreadId: '0',
    broadcastMessage: '',
    broadcastStatus: null,

    setThreads: (threads) => set({ threads }),
    addThread: (thread) => set((state) => ({ threads: [thread, ...state.threads] })),
    setUserThreads: (threads: { [threadName: string]: UserThread }) => set({ userThreads: threads }),
    removeUserThread: (threadName: string) => set((state) => {
        const { [threadName]: userThread, ...remainingUserThreads } = state.userThreads
        return {userThreads: remainingUserThreads}
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
