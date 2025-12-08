import { create } from 'zustand';
import { AgentState } from '@/lib/agent';

interface AgentStore {
    agents: AgentState[];

    // Actions
    getAgentByName: (name: string) => AgentState | undefined;
    spawnAgent: (agent: AgentState) => void;
    removeAgent: (agentUrl: string) => void;
    updateAgentPosition: (agentUrl: string, x: number, y: number) => void;
    updateAgentCharacterImage: (agentUrl: string, imageUrl: string) => void;
    setAgents: (agents: AgentState[]) => void;
    updateAgent: (agentUrl: string, updates: Partial<AgentState>) => void;
}

export const useAgentStore = create<AgentStore>((set, get) => ({
    agents: [], // A2A agents initialized to empty on refresh

    getAgentByName: (name) => {
        return get().agents.find((agent) => agent.name === name);
    },

    spawnAgent: (agent) => {
        const newAgentUrl = agent.agentUrl;
        const isExist = get().agents.find((agent) => agent.agentUrl === newAgentUrl);
        if (isExist) {
            return;
        }
        set((state) => ({
            agents: [...state.agents, agent]
        }));
    },

    removeAgent: (agentUrl) =>
        set((state) => {
            const removed = state.agents.find((agent) => agent.agentUrl === agentUrl);
            if (removed) {
                console.log(`🔄 A2A Agent removed: ${removed.name}`);
            }
            return { agents: state.agents.filter((agent) => agent.agentUrl !== agentUrl) };
        }),

    updateAgentPosition: (agentUrl, x, y) =>
        set((state) => {
            const agent = state.agents.find((agent) => agent.agentUrl === agentUrl);
            if (!agent) return state;
            return {
                agents: state.agents.map((agent) => agent.agentUrl === agentUrl ? { ...agent, x, y, lastMoved: Date.now() } : agent)
            };
        }),

    updateAgentCharacterImage: (agentUrl, imageUrl) =>
        set((state) => {
            const agent = state.agents.find((agent) => agent.agentUrl === agentUrl);
            if (!agent) return state;
            return {
                agents: state.agents.map((agent) => agent.agentUrl === agentUrl ? { ...agent, characterImage: imageUrl } : agent)
            };
        }),

    setAgents: (agents: AgentState[]) => set({ agents }),

    updateAgent: (agentUrl, updates) =>
        set((state) => {
            const agent = state.agents.find((agent) => agent.agentUrl === agentUrl);
            if (!agent) return state;
            return {
                agents: state.agents.map((agent) => agent.agentUrl === agentUrl ? { ...agent, ...updates } : agent)
            };
        })
}));
