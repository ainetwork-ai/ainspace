import { create } from 'zustand';
import { A2AAgent, A2AAgentState } from '@/lib/agent';

export interface AgentState {
    a2aAgents: { [agentUrl: string]: A2AAgent };

    // Actions
    spawnAgent: (agentUrl: string, agent: A2AAgent) => void;
    removeAgent: (agentUrl: string) => void;
    updateAgentPosition: (agentUrl: string, x: number, y: number) => void;
    updateAgentCharacterImage: (agentUrl: string, imageUrl: string) => void;
    setAgents: (agents: { [agentUrl: string]: A2AAgent }) => void;
    updateAgent: (agentUrl: string, updates: Partial<A2AAgentState>) => void;
}

export const useAgentStore = create<AgentState>((set, get) => ({
    a2aAgents: {},

    spawnAgent: (agentUrl, agent) =>
        set((state) => ({
            a2aAgents: {
                ...state.a2aAgents,
                [agentUrl]: agent
            }
        })),

    removeAgent: (agentUrl) =>
        set((state) => {
            const { [agentUrl]: removed, ...rest } = state.a2aAgents;
            return { a2aAgents: rest };
        }),

    updateAgentPosition: (agentUrl, x, y) =>
        set((state) => {
            const agent = state.a2aAgents[agentUrl];
            if (!agent) return state;
            agent.updateState({ x, y, lastMoved: Date.now() });
            return {
                a2aAgents: {
                    ...state.a2aAgents,
                    [agentUrl]: agent
                }
            };
        }),

    updateAgentCharacterImage: (agentUrl, imageUrl) =>
        set((state) => {
            const agent = state.a2aAgents[agentUrl];
            if (!agent) return state;
            agent.updateState({ characterImage: imageUrl });
            return {
                a2aAgents: {
                    ...state.a2aAgents,
                    [agentUrl]: agent
                }
            };
        }),

    setAgents: (a2aAgents) => set({ a2aAgents: a2aAgents }),

    updateAgent: (agentUrl, updates) =>
        set((state) => {
            const agent = state.a2aAgents[agentUrl];
            if (!agent) return state;
            agent.updateState({ ...updates });
            return {
                a2aAgents: {
                    ...state.a2aAgents,
                    [agentUrl]: agent
                }
            };
        })
}));
