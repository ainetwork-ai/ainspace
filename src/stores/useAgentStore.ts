import { AgentSkill } from '@a2a-js/sdk';
import { create } from 'zustand';

export interface AgentInformation {
    id: string;
    x: number;
    y: number;
    color: string;
    name: string;
    characterImage?: string;
    lastMoved?: number;
    moveInterval?: number; // Random interval for agent movement (ms)
    agentUrl?: string;
    skills?: AgentSkill[];
}

interface AgentState {
    agents: { [agentUrl: string]: AgentInformation };

    // Actions
    spawnAgent: (agentUrl: string, agent: AgentInformation) => void;
    removeAgent: (agentUrl: string) => void;
    updateAgentPosition: (agentUrl: string, x: number, y: number) => void;
    updateAgentCharacterImage: (agentUrl: string, imageUrl: string) => void;
    setAgents: (agents: { [agentUrl: string]: AgentInformation }) => void;
    updateAgent: (agentUrl: string, updates: Partial<AgentInformation>) => void;
}

export const useAgentStore = create<AgentState>((set, get) => ({
    agents: {},

    spawnAgent: (agentUrl, agent) =>
        set((state) => ({
            agents: {
                ...state.agents,
                [agentUrl]: agent
            }
        })),

    removeAgent: (agentUrl) =>
        set((state) => {
            const { [agentUrl]: removed, ...rest } = state.agents;
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
