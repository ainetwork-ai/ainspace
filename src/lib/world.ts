import { BaseAgent, createAgent, AgentState, Message as AgentMessage } from './agent';
import { INITIAL_PLAYER_POSITION } from '@/constants/game';

export interface Player {
    x: number;
    y: number;
}

export interface Message {
    id: string;
    content: string;
    sender: 'player';
    timestamp: Date;
    mentions: string[]; // Agent names that are mentioned
}

export interface AgentResponse {
    agentId: string;
    agentName: string;
    message: string;
    delay: number; // in milliseconds
    position: { x: number; y: number };
    distance: number;
    nextAgentRequest: string[];
}

export class World {
    private agents: AgentState[] = [];
    private agentInstances: BaseAgent[] = [];
    private player: Player = INITIAL_PLAYER_POSITION;
    private readonly MAX_SPEED = 10; // units per second

    constructor(agents: AgentState[], player: Player) {
        this.agents = agents;
        this.player = player;
        this.initializeAgentInstances();
    }

    private initializeAgentInstances(): void {
        this.agentInstances = this.agents.map((agent) => {
            const agentState: AgentState = {
                id: agent.id,
                name: agent.name,
                color: agent.color,
                x: agent.x,
                y: agent.y,
                behavior: agent.behavior,
                agentUrl: agent.agentUrl, // Include agentUrl for A2A agents
                skills: agent.skills
            };
            return createAgent(agent.behavior, agentState);
        });
    }

    updatePlayer(position: Player) {
        this.player = position;
    }

    updateAgents(agents: AgentState[]) {
        this.agents = agents;
        // Update existing agent instances or create new ones
        this.agentInstances = agents.map((agent) => {
            // Find existing instance
            const existingInstance = this.agentInstances.find((instance) => instance.id === agent.id);

            if (existingInstance) {
                // Update existing instance state
                existingInstance.updateState({
                    x: agent.x,
                    y: agent.y,
                    color: agent.color,
                    name: agent.name,
                    behavior: agent.behavior,
                    agentUrl: agent.agentUrl // Include agentUrl in update
                });
                return existingInstance;
            } else {
                return createAgent(agent.behavior, agent);
            }
        });
    }

    // Calculate Euclidean distance between two points
    private calculateDistance(pos1: { x: number; y: number }, pos2: { x: number; y: number }): number {
        return Math.sqrt(Math.pow(pos1.x - pos2.x, 2) + Math.pow(pos1.y - pos2.y, 2));
    }

    // Calculate message travel delay based on distance
    private calculateResponseDelay(distance: number, baseDelay: number = 500): number {
        const travelTime = (distance / this.MAX_SPEED) * 1000; // Convert to milliseconds
        return baseDelay + travelTime;
    }

    // Extract mentioned agent names from message content
    private extractMentions(content: string): string[] {
        const mentionRegex = /@(\w+(?:\s+\w+)*)/g;
        const mentions: string[] = [];
        let match;

        while ((match = mentionRegex.exec(content)) !== null) {
            mentions.push(match[1]);
        }

        return mentions;
    }

    private extractMentionedAgentsAndTasks(content: string): string[] {
        const regex = /@([^@]+?)\s*-\s*([^@]+?)(?=@|$)/g;
        const result: string[] = [];
        for (const [, name, req] of content.matchAll(regex)) {
            console.log('name, req :>> ', name, req);
            result.push(`@${name} ${req.trim()}`);
        }
        console.log(JSON.stringify(result, null, 2));
        return result;
    }

    // Find agents that are mentioned in the message
    private findMentionedAgents(mentions: string[]): AgentState[] {
        return this.agents.filter((agent) =>
            mentions.some(
                (mention) =>
                    agent.name.toLowerCase().includes(mention.toLowerCase()) ||
                    mention.toLowerCase().includes(agent.name.toLowerCase())
            )
        );
    }

    // Process incoming message and deliver to each agent
    async processMessage(content: string, broadcastRadius?: number, threadId?: string): Promise<AgentResponse[]> {
        const mentions = this.extractMentions(content);
        const agentSkills = this.agents
            .filter((agent) => agent.skills)
            .map((agent) => {
                return {
                    name: agent.name,
                    skills: agent.skills?.map((skill) => {
                        return {
                            name: skill.name,
                            description: skill.description,
                            tags: skill.tags
                        };
                    })
                };
            });

        let respondingAgentInstances: BaseAgent[];

        if (mentions.length > 0) {
            // If there are mentions, only mentioned agents respond (ignore radius for mentions)
            const mentionedAgents = this.findMentionedAgents(mentions);
            respondingAgentInstances = this.agentInstances.filter((instance) =>
                mentionedAgents.some((agent) => agent.id === instance.id)
            );
        } else {
            // If no mentions, filter agents by broadcast radius if specified
            if (broadcastRadius !== undefined) {
                respondingAgentInstances = this.agentInstances.filter((instance) => {
                    const distance = this.calculateDistance(this.player, instance.position);
                    return distance <= broadcastRadius;
                });

                // For broadcast messages, add agents to the thread
                if (threadId) {
                    respondingAgentInstances.forEach((instance) => {
                        instance.joinThread(threadId);
                    });
                }
            } else {
                // If no radius specified, all agents get the message
                respondingAgentInstances = this.agentInstances;
            }
        }

        respondingAgentInstances.forEach((instance) => {
            // instance.    HERE
            console.log('instance :>> ', instance.name, instance.position.x, instance.position.y);
        });
        console.log('respondingAgentInstances :>> ', respondingAgentInstances);
        // Process responses concurrently but with staggered delays
        const responsePromises = respondingAgentInstances.map(async (agentInstance, index) => {
            const distance = this.calculateDistance(this.player, agentInstance.position);

            // Check if this specific agent was mentioned
            const mentionedAgents = this.findMentionedAgents(mentions);
            const isMentioned = mentionedAgents.some((agent) => agent.id === agentInstance.id);

            // Create message for agent
            const agentMessage: AgentMessage = {
                id: `msg-${Date.now()}-${index}`,
                content: content,
                sender: 'player',
                timestamp: new Date(),
                playerPosition: { ...this.player },
                distance: distance,
                isMentioned: isMentioned,
                threadId: threadId
            };

            // Calculate total delay (travel time + stagger)
            const staggerDelay = index * 100;
            const totalDelay = this.calculateResponseDelay(distance, 500 + staggerDelay);

            // Let agent process the message
            const agentResponse = await agentInstance.processMessage(agentMessage, totalDelay, { agentSkills });

            if (agentResponse) {
                const nextAgentRequest = this.extractMentionedAgentsAndTasks(agentResponse?.message);
                console.log('nextAgentRequest :>> ', nextAgentRequest);

                return {
                    agentId: agentResponse.agentId,
                    agentName: agentInstance.name,
                    message: agentResponse.message,
                    delay: agentResponse.delay,
                    position: { x: agentInstance.x, y: agentInstance.y },
                    distance: distance,
                    nextAgentRequest: nextAgentRequest || []
                };
            }

            return null;
        });

        // Wait for all responses and filter out null values
        const allResponses = await Promise.all(responsePromises);
        return allResponses.filter((response): response is AgentResponse => response !== null);
    }

    // Get all agents within a certain radius (for autocomplete suggestions)
    getAgentsInRange(radius?: number): AgentState[] {
        if (radius === undefined) {
            return this.agents;
        }

        return this.agents.filter((agent) => {
            const distance = this.calculateDistance(this.player, { x: agent.x, y: agent.y });
            return distance <= radius;
        });
    }

    // Get agent suggestions for autocomplete based on partial name
    getAgentSuggestions(partialName: string): AgentState[] {
        const searchTerm = partialName.toLowerCase();
        return this.agents.filter((agent) => agent.name.toLowerCase().includes(searchTerm));
    }

    // Get current player position
    getPlayerPosition(): Player {
        return { ...this.player };
    }

    // Get all agents
    getAllAgents(): AgentState[] {
        return [...this.agents];
    }
}
