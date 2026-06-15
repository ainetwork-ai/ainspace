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
    // EPIC18: when true, the next backend DM creation forks a fresh conversation
    // (forceNew) instead of reusing the deduped one. Set on kiosk Ctrl+K reset,
    // consumed (and cleared) by the first thread creation after it.
    forceNewPending: boolean;

    // Actions
    setThreads: (threads: Thread[]) => void;
    addThread: (thread: Thread) => void;
    findThreadByName: (threadName: string) => Thread | undefined;
    findThreadById: (threadId: string) => Thread | undefined;
    updateThread: (threadId: string, updates: Partial<Thread>) => void;
    removeThread: (threadId: string) => void;
    clearThreads: () => void;
    setCurrentThreadId: (threadId: string | undefined) => void;
    setForceNewPending: (pending: boolean) => void;
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
    forceNewPending: false,

    setThreads: (threads) => set({ threads }),
    // EPIC15: upsert by id — backend returns the existing DM for a repeated
    // agent combination, so adding by id must replace rather than duplicate.
    addThread: (thread) => set((state) => {
        const idx = state.threads.findIndex((t) => t.id === thread.id);
        if (idx === -1) return { threads: [thread, ...state.threads] };
        const threads = [...state.threads];
        threads[idx] = thread;
        return { threads };
    }),
    findThreadByName: (threadName) => get().threads.find(thread => thread.threadName === threadName),
    findThreadById: (threadId) => get().threads.find(thread => thread.id === threadId),
    updateThread: (threadId, updates) => set((state) => {
        return { threads: state.threads.map(t => t.id === threadId ? { ...t, ...updates } : t) }
    }),
    removeThread: (threadId: string) => set((state) => {
        return { threads: state.threads.filter(thread => thread.id !== threadId) }
    }),
    clearThreads: () => set({ threads: [] }),
    setCurrentThreadId: (threadId) => set({ currentThreadId: threadId }),
    setForceNewPending: (pending) => set({ forceNewPending: pending }),
    setBroadcastMessage: (message) => set({ broadcastMessage: message }),
    setBroadcastStatus: (status) => set({ broadcastStatus: status }),
    clearBroadcastMessage: () => set({ broadcastMessage: '' }),
    clearBroadcastStatusAfterDelay: (delay) => {
        setTimeout(() => {
            set({ broadcastStatus: null });
        }, delay);
    }
}));
