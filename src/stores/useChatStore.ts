import { create } from 'zustand';

export interface ChatMessage {
    id: string;
    text: string;
    timestamp: Date;
    sender: 'user' | 'system' | 'ai';
    senderId?: string;
    threadId?: string;
}

export interface ThreadMessages {
  [threadId: string]: ChatMessage[];
}

interface ChatState {
    messages: ThreadMessages;
    loadingAgents: Set<string>; // Set of agent IDs that are currently loading

    // Actions
    setMessages: (threadId: string, messagesOrUpdater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
    addMessage: (threadId: string, message: ChatMessage) => void;
    clearMessages: () => void;
    getMessagesByThreadId: (threadId: string) => ChatMessage[];
    setAgentLoading: (agentId: string, isLoading: boolean) => void;
    isAgentLoading: (agentId: string) => boolean;
}

export const useChatStore = create<ChatState>((set, get) => ({
    messages: {},
    loadingAgents: new Set<string>(),

    setMessages: (threadId, messagesOrUpdater) => {
        set((state) => {
            const newMessages =
                typeof messagesOrUpdater === 'function' ? messagesOrUpdater(state.messages[threadId]) : messagesOrUpdater;
            console.log('💬 Setting messages in store:', newMessages);
            return { messages: { ...state.messages, [threadId]: newMessages } };
        });
    },

    clearMessages: () => set({ messages: {} }),

    addMessage: (threadId, message) => {
        set((state) => {
            return { messages: { ...state.messages, [threadId]: [...state.messages[threadId], message] } };
        });
    },

    getMessagesByThreadId: (threadId) => {
        return get().messages[threadId] || [];
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
