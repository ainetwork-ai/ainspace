import { create } from 'zustand';
import { StoredAgent } from '@/lib/redis';

interface UserAgentStore {
    agents: StoredAgent[];
    isLoading: boolean;

    // Actions
    setAgents: (agents: StoredAgent[]) => void;
    addAgent: (agent: StoredAgent) => void;
    removeAgent: (agentUrl: string) => void;
    updateAgent: (agentUrl: string, updates: Partial<StoredAgent>) => void;
    getAgentByUrl: (agentUrl: string) => StoredAgent | undefined;
    getPlacedAgents: () => StoredAgent[];
    getUnplacedAgents: () => StoredAgent[];
    setLoading: (loading: boolean) => void;
    clear: () => void;
}

export const useUserAgentStore = create<UserAgentStore>((set, get) => ({
    agents: [],
    isLoading: false,

    setAgents: (agents) => set({ agents }),

    addAgent: (agent) => {
        const existing = get().agents.find((a) => a.url === agent.url);
        if (existing) {
            return;
        }
        set((state) => ({
            agents: [...state.agents, agent]
        }));
    },

    removeAgent: (agentUrl) =>
        set((state) => ({
            agents: state.agents.filter((agent) => agent.url !== agentUrl)
        })),

    updateAgent: (agentUrl, updates) =>
        set((state) => ({
            agents: state.agents.map((agent) =>
                agent.url === agentUrl ? { ...agent, ...updates } : agent
            )
        })),

    getAgentByUrl: (agentUrl) => {
        return get().agents.find((agent) => agent.url === agentUrl);
    },

    getPlacedAgents: () => {
        return get().agents.filter((agent) => agent.isPlaced === true);
    },

    getUnplacedAgents: () => {
        return get().agents.filter((agent) => agent.isPlaced !== true);
    },

    setLoading: (loading) => set({ isLoading: loading }),

    clear: () => set({ agents: [], isLoading: false })
}));
