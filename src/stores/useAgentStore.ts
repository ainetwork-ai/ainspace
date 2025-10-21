import { create } from 'zustand';

export interface SpawnedA2AAgent {
    id: string;
    name: string;
    x: number;
    y: number;
    color: string;
    agentUrl: string;
    lastMoved: number;
    characterImage?: string;
}

interface AgentState {
    spawnedA2AAgents: { [agentUrl: string]: SpawnedA2AAgent };

    // Actions
    spawnAgent: (agentUrl: string, agent: SpawnedA2AAgent) => void;
    removeAgent: (agentUrl: string) => void;
    updateAgentPosition: (agentUrl: string, x: number, y: number) => void;
    updateAgentCharacterImage: (agentUrl: string, imageUrl: string) => void;
    setAgents: (agents: { [agentUrl: string]: SpawnedA2AAgent }) => void;
    updateAgent: (agentUrl: string, updates: Partial<SpawnedA2AAgent>) => void;
}

export const useAgentStore = create<AgentState>((set, get) => ({
    spawnedA2AAgents: {},

    spawnAgent: (agentUrl, agent) =>
        set((state) => ({
            spawnedA2AAgents: {
                ...state.spawnedA2AAgents,
                [agentUrl]: agent
            }
        })),

    removeAgent: (agentUrl) =>
        set((state) => {
            const { [agentUrl]: removed, ...rest } = state.spawnedA2AAgents;
            return { spawnedA2AAgents: rest };
        }),

    updateAgentPosition: (agentUrl, x, y) =>
        set((state) => {
            const agent = state.spawnedA2AAgents[agentUrl];
            if (!agent) return state;
            return {
                spawnedA2AAgents: {
                    ...state.spawnedA2AAgents,
                    [agentUrl]: { ...agent, x, y, lastMoved: Date.now() }
                }
            };
        }),

    updateAgentCharacterImage: (agentUrl, imageUrl) =>
        set((state) => {
            const agent = state.spawnedA2AAgents[agentUrl];
            if (!agent) return state;
            return {
                spawnedA2AAgents: {
                    ...state.spawnedA2AAgents,
                    [agentUrl]: { ...agent, characterImage: imageUrl }
                }
            };
        }),

    setAgents: (agents) => set({ spawnedA2AAgents: agents }),

    updateAgent: (agentUrl, updates) =>
        set((state) => {
            const agent = state.spawnedA2AAgents[agentUrl];
            if (!agent) return state;
            return {
                spawnedA2AAgents: {
                    ...state.spawnedA2AAgents,
                    [agentUrl]: { ...agent, ...updates }
                }
            };
        })
}));
