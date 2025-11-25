import { create } from 'zustand';
import { AgentState } from '@/lib/agent';

export interface VisibleAgent extends AgentState {
    isMoving?: boolean;
    spriteUrl?: string;
    spriteHeight?: number;
    spriteWidth?: number;
}

interface AgentStore {
    agents: { [agentUrl: string]: VisibleAgent };

    // Actions
    spawnAgent: (agentUrl: string, agent: VisibleAgent) => void;
    removeAgent: (agentUrl: string) => void;
    updateAgentPosition: (agentUrl: string, x: number, y: number) => void;
    updateAgentCharacterImage: (agentUrl: string, imageUrl: string) => void;
    setAgents: (agents: { [agentUrl: string]: VisibleAgent }) => void;
    updateAgent: (agentUrl: string, updates: Partial<VisibleAgent>) => void;
}

export const useAgentStore = create<AgentStore>((set, get) => ({
    agents: {}, // A2A agents initialized to empty on refresh

    spawnAgent: (agentUrl, agent) => {
        console.log(`🔄 A2A Agent spawned: ${agent.name} at (${agent.x}, ${agent.y})`);
        return set((state) => ({
            agents: {
                ...state.agents,
                [agentUrl]: agent
            }
        }));
    },

    removeAgent: (agentUrl) =>
        set((state) => {
            const { [agentUrl]: removed, ...rest } = state.agents;
            if (removed) {
                console.log(`🔄 A2A Agent removed: ${removed.name}`);
            }
            return { agents: rest };
        }),

    updateAgentPosition: (agentUrl, x, y) =>
        set((state) => {
            const agent = state.agents[agentUrl];
            if (!agent) return state;
            return {
                agents: {
                    ...state.agents,
                    [agentUrl]: { ...agent, x, y, lastMoved: Date.now() }
                }
            };
        }),

    updateAgentCharacterImage: (agentUrl, imageUrl) =>
        set((state) => {
            const agent = state.agents[agentUrl];
            if (!agent) return state;
            return {
                agents: {
                    ...state.agents,
                    [agentUrl]: { ...agent, characterImage: imageUrl }
                }
            };
        }),

    setAgents: (agents) => set({ agents: agents }),

    updateAgent: (agentUrl, updates) =>
        set((state) => {
            const agent = state.agents[agentUrl];
            if (!agent) return state;
            return {
                agents: {
                    ...state.agents,
                    [agentUrl]: { ...agent, ...updates }
                }
            };
        })
}));
