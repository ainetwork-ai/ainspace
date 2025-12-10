import { NextRequest, NextResponse } from 'next/server';
import { createThread, addAgentToThread, sendMessage, Agent as A2AAgent } from '@/lib/a2aOrchestration';
import { getAgents, StoredAgent } from '@/lib/redis';

interface Position {
    x: number;
    y: number;
}

interface RequestBody {
    message: string;
    playerPosition: Position;
    broadcastRadius?: number;
    threadId?: string;
    agentNames?: string[]; // Explicit list of agent names to include in thread (from frontend calculation)
    mentionedAgents?: string[]; // Array of agent names that were mentioned
}

/**
 * Calculate Euclidean distance between two positions
 */
function calculateDistance(pos1: Position, pos2: Position): number {
    return Math.sqrt(Math.pow(pos1.x - pos2.x, 2) + Math.pow(pos1.y - pos2.y, 2));
}

/**
 * Find agents within broadcast radius or mentioned agents
 */
async function findAgentsInRange(
    playerPosition: Position,
    broadcastRadius?: number,
    mentionedAgents?: string[]
): Promise<StoredAgent[]> {
    // Get only placed agents
    const allAgents = (await getAgents()).filter((agent) => agent.isPlaced !== false);

    // If specific agents are mentioned, return only those
    if (mentionedAgents && mentionedAgents.length > 0) {
        return allAgents.filter((agent) =>
            mentionedAgents.some((mentioned) => agent.card.name.toLowerCase() === mentioned.toLowerCase())
        );
    }

    // If no broadcast radius, return all agents
    if (broadcastRadius === undefined) {
        return allAgents;
    }

    // Filter agents by distance (if they have position data)
    return allAgents.filter((agent) => {
        const { x, y } = agent.state;
        if (!x || !y) {
            return true; // Include agents without position data
        }
        const distance = calculateDistance(playerPosition, { x, y });
        return distance <= broadcastRadius;
    });
}

/**
 * Convert local agent format to A2A orchestration format
 */
function convertToA2AAgent(agent: StoredAgent): A2AAgent {
    return {
        name: agent.card.name,
        role: 'Assistant', // NOTE(yoojin): 이게 왜 필요할까요.
        a2aUrl: agent.url
    };
}

export async function POST(request: NextRequest) {
    try {
        const body: RequestBody = await request.json();
        const { message, playerPosition, broadcastRadius, threadId, agentNames, mentionedAgents } = body;

        if (!message || !playerPosition) {
            return NextResponse.json({ error: 'Message and playerPosition are required' }, { status: 400 });
        }

        let agentsInRange: StoredAgent[];

        // If frontend explicitly provides agent names, use those
        if (agentNames && agentNames.length > 0) {
            console.log('Using agent names from frontend:', agentNames);
            const allAgents = (await getAgents()).filter((agent) => agent.isPlaced !== false);
            agentsInRange = allAgents.filter((agent) =>
                agentNames.some((name) => agent.card.name.toLowerCase() === name.toLowerCase())
            );
            console.log(
                'Found agents:',
                agentsInRange.map((a) => a.card.name)
            );
        } else {
            // Otherwise, find agents in range (legacy behavior)
            console.log('Calculating agents in range on backend');
            agentsInRange = await findAgentsInRange(playerPosition, broadcastRadius, mentionedAgents);
        }

        if (agentsInRange.length === 0) {
            return NextResponse.json({ error: 'No agents found in range' }, { status: 404 });
        }

        // Create new thread if not provided
        let currentThreadId = threadId;
        let isNewThread = false;

        if (!currentThreadId) {
            try {
                console.log('Creating new A2A thread...');
                const newThread = await createThread();
                currentThreadId = newThread.id;
                isNewThread = true;
                console.log('Created thread:', currentThreadId);
            } catch (error) {
                console.error('Failed to create A2A thread:', error);
                return NextResponse.json(
                    {
                        error: 'Failed to create thread',
                        details: error instanceof Error ? error.message : 'Unknown error'
                    },
                    { status: 500 }
                );
            }
        }

        let successfulAgents: { success: boolean; agent: string }[] = [];
        let failedAgents: { success: boolean; agent: string; error?: unknown }[] = [];

        // Only add agents if this is a new thread
        if (isNewThread) {
            // Add all agents in range to the thread
            // We already have the agent card data from Redis, so we don't need to import
            const addAgentPromises = agentsInRange.map(async (agent) => {
                try {
                    // Convert stored agent to A2A format
                    const a2aAgent = convertToA2AAgent(agent);
                    console.log(`Adding agent ${a2aAgent.name} to thread ${currentThreadId}`);

                    // Add to thread (no need to import since we already have the card data)
                    await addAgentToThread(currentThreadId!, a2aAgent);
                    console.log(`Successfully added agent ${a2aAgent.name} to thread`);

                    return { success: true, agent: agent.card.name };
                } catch (error) {
                    console.error(`Failed to add agent ${agent.card.name} to thread:`, error);
                    return { success: false, agent: agent.card.name, error };
                }
            });

            const addResults = await Promise.all(addAgentPromises);
            successfulAgents = addResults.filter((r) => r.success);
            failedAgents = addResults.filter((r) => !r.success);

            if (successfulAgents.length === 0) {
                return NextResponse.json(
                    { error: 'Failed to add any agents to thread', details: failedAgents },
                    { status: 500 }
                );
            }
        } else {
            console.log('Using existing thread, skipping agent addition');
        }

        // Send message to the thread
        try {
            console.log(`Sending message to thread ${currentThreadId}:`, message);
            await sendMessage(currentThreadId, message);
            console.log('Message sent successfully');
        } catch (error) {
            console.error('Failed to send message to thread:', error);
            return NextResponse.json(
                {
                    error: 'Failed to send message to thread',
                    details: error instanceof Error ? error.message : 'Unknown error',
                    threadId: currentThreadId // Return threadId even on failure so frontend can retry
                },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            threadId: currentThreadId,
            agentsAdded: successfulAgents.length,
            totalAgents: agentsInRange.length,
            failedAgents: failedAgents.length > 0 ? failedAgents : undefined,
            isNewThread
        });
    } catch (error: unknown) {
        console.error('Thread message error:', error);
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : 'Failed to send thread message'
            },
            { status: 500 }
        );
    }
}
