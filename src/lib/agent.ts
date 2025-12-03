import { AgentSkill } from '@a2a-js/sdk';
import { useChatStore } from '@/stores/useChatStore';
import { AGENT_RESPONSE_DISTANCE, DIRECTION } from '@/constants/game';

export interface AgentInfo {
    id: string;
    name: string;
    agentUrl: string;
    skills: AgentSkill[];
}

export interface AgentWorldState {
    x: number;
    y: number;
    behavior: string;
    color: string;

    direction?: DIRECTION;
    lastMoved?: number;
    moveInterval?: number;
    isMoving?: boolean;
};

export interface AgentVisualState {
    spriteUrl?: string;
    spriteHeight?: number;
    spriteWidth?: number;
}

export interface AgentState extends AgentInfo, AgentWorldState, AgentVisualState {}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface AgentStateForDB extends Omit<AgentWorldState, 'direction' | 'lastMoved' | 'isMoving'> {}

export interface Message {
    id: string;
    content: string;
    sender: 'player';
    timestamp: Date;
    playerPosition: { x: number; y: number };
    distance: number;
    isMentioned: boolean;
    threadId?: string;
}

export interface AgentResponse {
    agentId: string;
    message: string;
    timestamp: Date;
    delay: number;
}

export abstract class BaseAgent {
    protected state: AgentState;
    protected activeThreads: Set<string> = new Set();

    constructor(initialState: AgentState) {
        this.state = { ...initialState };
    }

    // Getters
    get id(): string {
        return this.state.id;
    }
    get name(): string {
        return this.state.name;
    }
    get x(): number {
        return this.state.x;
    }
    get y(): number {
        return this.state.y;
    }
    get behavior(): string {
        return this.state.behavior;
    }
    get position(): { x: number; y: number } {
        return { x: this.state.x, y: this.state.y };
    }

    // Update agent state
    updateState(newState: Partial<AgentState>): void {
        this.state = { ...this.state, ...newState };
    }

    // Abstract method for agent-specific message processing
    protected abstract shouldRespondToMessage(message?: Message): boolean;

    // Add agent to a thread
    joinThread(threadId: string): void {
        this.activeThreads.add(threadId);
    }

    // Remove agent from a thread
    leaveThread(threadId: string): void {
        this.activeThreads.delete(threadId);
    }

    // Check if agent is in a thread
    isInThread(threadId: string): boolean {
        return this.activeThreads.has(threadId);
    }

    // Process incoming message and generate response if appropriate
    async processMessage(
        message: Message,
        totalDelay: number,
        metadata?: { [key: string]: unknown }
    ): Promise<AgentResponse | null> {
        // Calculate Chebyshev distance (max of absolute differences in x and y)
        const dx = Math.abs(this.state.x - message.playerPosition.x);
        const dy = Math.abs(this.state.y - message.playerPosition.y);
        const chebyshevDistance = Math.max(dx, dy);

        console.log(`Agent ${this.name} processing message:`, {
            threadId: message.threadId,
            metadata,
            isMentioned: message.isMentioned,
            isInThread: message.threadId ? this.isInThread(message.threadId) : 'N/A',
            activeThreads: Array.from(this.activeThreads),
            chebyshevDistance,
            agentPosition: { x: this.state.x, y: this.state.y },
            playerPosition: message.playerPosition
        });

        // Check if player is within response range (Chebyshev distance)
        // Only apply distance check if agent is not mentioned
        if (!message.isMentioned && chebyshevDistance > AGENT_RESPONSE_DISTANCE) {
            console.log(`🚫❌ Agent ${this.name} not responding: player is too far (distance: ${chebyshevDistance})`);
            return null;
        }

        if (chebyshevDistance <= AGENT_RESPONSE_DISTANCE) {
            console.log(`✅🎯 Agent ${this.name} is in range! Distance: ${chebyshevDistance}`);
        }

        // Check thread participation
        if (message.threadId) {
            // If this is a threaded message, only respond if we're in the thread OR being mentioned
            if (!this.isInThread(message.threadId) && !message.isMentioned) {
                console.log(`Agent ${this.name} not responding: not in thread ${message.threadId} and not mentioned`);
                return null;
            }
            // If mentioned in a thread we're not in, join the thread
            if (message.isMentioned && !this.isInThread(message.threadId)) {
                console.log(`Agent ${this.name} joining thread ${message.threadId} due to mention`);
                this.joinThread(message.threadId);
            }
        } else {
            // For non-threaded messages, check if this agent should respond
            if (!message.isMentioned && !this.shouldRespondToMessage(message)) {
                return null;
            }
        }

        try {
            // Set agent as loading before calling Gemini API
            useChatStore.getState().setAgentLoading(this.state.id, true);

            // Generate response using server-side API
            console.log(`🤖✨ Gemini API 호출 시작! Agent: ${this.state.name}, Distance: ${chebyshevDistance}`);

            const response = await fetch('/api/agent-response', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    agentData: {
                        name: this.state.name,
                        behavior: this.state.behavior,
                        position: { x: this.state.x, y: this.state.y },
                        playerPosition: message.playerPosition,
                        distance: message.distance,
                        userMessage: message.content,
                        isMentioned: message.isMentioned
                    }
                })
            });

            if (!response.ok) {
                throw new Error(`API request failed: ${response.status}`);
            }

            const data = await response.json();
            const responseText = data.response;

            console.log(
                `💬🎉 Gemini 응답 성공! Agent: ${this.state.name}, Response: "${responseText.substring(0, 50)}..."`
            );

            // Clear loading state after successful response
            useChatStore.getState().setAgentLoading(this.state.id, false);

            return {
                agentId: this.state.id,
                message: responseText,
                timestamp: new Date(),
                delay: totalDelay
            };
        } catch (error) {
            console.error(`Error processing message for ${this.state.name}:`, error);

            // Clear loading state on error
            useChatStore.getState().setAgentLoading(this.state.id, false);

            // Fallback response
            return {
                agentId: this.state.id,
                message: `${this.state.name} at (${this.state.x}, ${this.state.y}) received your message but couldn't respond properly.`,
                timestamp: new Date(),
                delay: totalDelay
            };
        }
    }

    // Get agent state for world system
    getState(): AgentState {
        return { ...this.state };
    }
}

export class ExplorerAgent extends BaseAgent {
    constructor(initialState: AgentState) {
        super(initialState);
    }

    protected shouldRespondToMessage(_message?: Message): boolean {
        // All agents are responsive - always respond to non-mentioned messages
        return true;
    }
}

export class PatrolAgent extends BaseAgent {
    constructor(initialState: AgentState) {
        super(initialState);
    }

    protected shouldRespondToMessage(_message?: Message): boolean {
        // All agents are responsive - always respond to non-mentioned messages
        return true;
    }
}

export class WandererAgent extends BaseAgent {
    constructor(initialState: AgentState) {
        super(initialState);
    }

    protected shouldRespondToMessage(_message?: Message): boolean {
        // All agents are responsive - always respond to non-mentioned messages
        return true;
    }
}

// A2A Agent class - represents imported A2A protocol agents
export class A2AAgent extends BaseAgent {
    private agentUrl: string;

    constructor(initialState: AgentState) {
        super(initialState);
        this.agentUrl = initialState.agentUrl || '';
    }

    updateState(newState: Partial<AgentState>): void {
        super.updateState(newState);
        if (newState.agentUrl !== undefined) {
            this.agentUrl = newState.agentUrl;
        }
    }

    async move(): Promise<void> {
        // A2A agents are managed by the main application, not this system
        // They have their own movement logic in the frontend
        return;
    }

    async processMessage(
        message: Message,
        totalDelay: number,
        metadata?: { [key: string]: unknown }
    ): Promise<AgentResponse | null> {
        if (!this.shouldRespondToMessage(message)) {
            return null;
        }

        console.log(`A2A Agent ${this.name} processing message with agentUrl:`, this.agentUrl);

        if (metadata?.agentSkills) {
            metadata.agentSkills = (metadata.agentSkills as AgentSkill[]).filter((agent) => agent.name !== this.name);
        }

        if (!this.agentUrl) {
            console.error(`A2A Agent ${this.name} has no agentUrl configured`);
            return null;
        }

        try {
            // Set agent as loading before calling A2A API
            useChatStore.getState().setAgentLoading(this.id, true);

            const requestBody = {
                agentUrl: this.agentUrl,
                message: `[From player at (${message.playerPosition.x}, ${message.playerPosition.y})]: ${message.content}`,
                metadata: metadata
            };

            console.log(`Sending to agent-chat API:`, requestBody);

            // Send message to A2A agent through API
            const response = await fetch('/api/agent-chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            if (response.ok) {
                const data = await response.json();
                if (data.response && data.response !== 'Agent received your message but did not respond.') {
                    // Clear loading state after successful response
                    useChatStore.getState().setAgentLoading(this.id, false);

                    return {
                        agentId: this.id,
                        message: data.response,
                        timestamp: new Date(),
                        delay: Math.random() * 1000 + 500 // Random delay 0.5-1.5 seconds
                    };
                }
            }

            // Clear loading state if no valid response
            useChatStore.getState().setAgentLoading(this.id, false);
        } catch (error) {
            console.error(`Failed to send message to A2A agent ${this.name}:`, error);

            // Clear loading state on error
            useChatStore.getState().setAgentLoading(this.id, false);
        }

        return null;
    }

    protected shouldRespondToMessage(message: Message): boolean {
        // A2A agents respond to messages within range
        return message.distance <= 10; // Same as broadcast range
    }

    getAgentUrl(): string {
        return this.agentUrl;
    }

    setAgentUrl(url: string): void {
        this.agentUrl = url;
    }
}

// Agent factory function
export function createAgent(type: string, initialState: AgentState): BaseAgent {
    switch (type) {
        case 'random':
            return new ExplorerAgent(initialState);
        case 'patrol':
            return new PatrolAgent(initialState);
        case 'explorer':
            return new WandererAgent(initialState);
        case 'A2A Agent':
            return new A2AAgent(initialState);
        default:
            throw new Error(`Unknown agent type: ${type}`);
    }
}
