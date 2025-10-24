import { create } from 'zustand';

export interface ChatMessage {
    id: string;
    text: string;
    timestamp: Date;
    sender: 'user' | 'system' | 'ai';
    senderId?: string;
    threadId?: string;
}

interface ChatState {
    messages: ChatMessage[];
    loadingAgents: Set<string>; // Set of agent IDs that are currently loading

    // Actions
    setMessages: (messagesOrUpdater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
    clearMessages: () => void;
    getMessagesByThread: (threadId?: string) => ChatMessage[];
    setAgentLoading: (agentId: string, isLoading: boolean) => void;
    isAgentLoading: (agentId: string) => boolean;
}

export const useChatStore = create<ChatState>((set, get) => ({
    messages: [],
    loadingAgents: new Set<string>(),

    setMessages: (messagesOrUpdater) => {
        set((state) => {
            const newMessages =
                typeof messagesOrUpdater === 'function' ? messagesOrUpdater(state.messages) : messagesOrUpdater;
            console.log('💬 Setting messages in store:', newMessages);
            return { messages: newMessages };
        });
    },

    clearMessages: () => set({ messages: [] }),

    getMessagesByThread: (threadId) => {
        const messages = get().messages;
        if (threadId) {
            return messages.filter((msg) => msg.threadId === threadId);
        }
        return messages.filter((msg) => !msg.threadId);
    },

    setAgentLoading: (agentId, isLoading) => {
        set((state) => {
            const newLoadingAgents = new Set(state.loadingAgents);
            if (isLoading) {
                newLoadingAgents.add(agentId);
                console.log(`💬🔄 Agent ${agentId} started loading (calling Gemini)`);
            } else {
                newLoadingAgents.delete(agentId);
                console.log(`💬✅ Agent ${agentId} finished loading (received response)`);
            }
            return { loadingAgents: newLoadingAgents };
        });
    },

    isAgentLoading: (agentId) => {
        return get().loadingAgents.has(agentId);
    }
}));
