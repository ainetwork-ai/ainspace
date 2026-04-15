import { NextRequest, NextResponse } from 'next/server';
import { createThread, addAgentToThread, Agent as A2AAgent } from '@/lib/a2aOrchestration';
import { getAgents, StoredAgent } from '@/lib/redis';

interface RequestBody {
    agentNames: string[];
    userId: string;
}

function convertToA2AAgent(agent: StoredAgent): A2AAgent {
    return {
        name: agent.card.name,
        role: 'Assistant',
        a2aUrl: agent.url
    };
}

export async function POST(request: NextRequest) {
    try {
        const body: RequestBody = await request.json();
        const { agentNames, userId } = body;

        if (!agentNames || agentNames.length === 0 || !userId) {
            return NextResponse.json(
                { error: 'agentNames and userId are required' },
                { status: 400 }
            );
        }

        // Find matching agents from Redis
        const allAgents = (await getAgents()).filter((agent) => agent.isPlaced !== false);
        const agentsInRange = allAgents.filter((agent) =>
            agentNames.some((name) => agent.card.name.toLowerCase() === name.toLowerCase())
        );

        if (agentsInRange.length === 0) {
            return NextResponse.json(
                { error: 'No matching agents found' },
                { status: 404 }
            );
        }

        // Create thread
        const newThread = await createThread(userId);
        const threadId = newThread.id;

        // Add agents to thread
        const addResults = await Promise.all(
            agentsInRange.map(async (agent) => {
                try {
                    await addAgentToThread(threadId, convertToA2AAgent(agent));
                    return { success: true, agent: agent.card.name };
                } catch (error) {
                    console.error(`Failed to add agent ${agent.card.name}:`, error);
                    return { success: false, agent: agent.card.name, error: error instanceof Error ? error.message : String(error) };
                }
            })
        );

        const successfulAgents = addResults.filter((r) => r.success);
        const failedAgents = addResults.filter((r) => !r.success);

        if (successfulAgents.length === 0) {
            return NextResponse.json(
                { error: 'Failed to add any agents to thread', details: failedAgents },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            threadId,
            agentsAdded: successfulAgents.length,
            totalAgents: agentsInRange.length,
            failedAgents: failedAgents.length > 0 ? failedAgents : undefined,
        });
    } catch (error: unknown) {
        console.error('Thread create error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to create thread' },
            { status: 500 }
        );
    }
}
