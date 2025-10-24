import { AgentSkill } from '@a2a-js/sdk';
import { create } from 'zustand';
import { DIRECTION } from '@/constants/game';

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
    spriteUrl?: string; // Sprite image for movement animation
    spriteHeight?: number; // Height of the sprite (e.g., 40 for cat, 86 for default sprites)
    direction?: DIRECTION; // Current facing direction (DIRECTION enum)
    isMoving?: boolean; // Whether agent is currently moving
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
