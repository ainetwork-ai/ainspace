import { create } from 'zustand';

export interface ChatMessageFile {
    /**
     * backend `files.id`. **렌더에 필요한 유일한 값**이다 — 서빙 URL 을 이걸로 조립한다
     * (EPIC23). `fileUrl` 을 쓰지 않는 이유는 아래 참조.
     */
    id: string;
    /**
     * ⚠️ **렌더에 쓰지 말 것.** backend 의 저장형이라 값이 `s3://버킷/키` 인 내부
     * 포인터다(자체호스팅 스토리지는 외부에 노출되지 않는다). `<img src>` 에 넣으면
     * 브라우저가 열지 못해 아무것도 안 보인다 — EPIC23 이 고친 그 증상이다.
     * 진단·로깅용으로만 남겨 둔다. URL 조립은 `lib/backend/chat-files.ts` 가 소유한다.
     */
    fileUrl: string | null;
    mimeType?: string | null;
    fileName?: string | null;
    width?: number | null;
    height?: number | null;
}

export interface ChatMessage {
    id: string;
    text: string;
    timestamp: Date;
    sender: 'user' | 'system' | 'ai';
    senderId?: string;
    // Backend-provided author avatar (agents). Used as a fallback when the agent
    // isn't found in the local agent store. Absent on SSE-streamed messages.
    avatarUrl?: string;
    // Stable backend user UUID of the author (== StoredAgent.backendUuid). Used
    // to match the agent in the local store reliably (displayName is unreliable).
    senderUserId?: string;
    threadId?: string;
    // EPIC22: files attached to the message (agent-sent images).
    files?: ChatMessageFile[];
}

export interface ThreadMessages {
  [threadId: string]: ChatMessage[];
}

interface ChatState {
    messages: ThreadMessages;
    loadingAgents: Set<string>; // Set of agent IDs that are currently loading

    // Actions
    setMessages: (messagesOrUpdater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[]), threadId?: string) => void;
    addMessage: (threadId: string, message: ChatMessage) => void;
    clearMessages: () => void;
    getMessagesByThreadId: (threadId: string) => ChatMessage[];
    setAgentLoading: (agentId: string, isLoading: boolean) => void;
    isAgentLoading: (agentId: string) => boolean;
}

export const useChatStore = create<ChatState>((set, get) => ({
    messages: {},
    loadingAgents: new Set<string>(),

    setMessages: (messagesOrUpdater, threadId = '0') => {
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
