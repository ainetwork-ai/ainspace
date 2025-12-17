import { NextRequest, NextResponse } from 'next/server';
import { getAgents, getThreads, saveThread } from '@/lib/redis';
import { generateAgentComboId } from '@/lib/hash';
import { Thread } from '@/stores';
import { Thread as A2AThread } from '@/lib/a2aOrchestration';

const A2A_ORCHESTRATION_BASE_URL = process.env.NEXT_PUBLIC_A2A_ORCHESTRATION_BASE_URL;

interface ThreadResponse {
    success: boolean;
    thread: A2AThread;
}

/**
 * GET /api/threads?userId={address}
 * Get all threads for a user
 */
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const userId = searchParams.get('userId');

        if (!userId) {
            return NextResponse.json({ error: 'userId is required' }, { status: 400 });
        }

        const threads = await getThreads(userId);
        const threadEntries = Object.entries(threads);

        if (threadEntries.length === 0) {
            return NextResponse.json({
                success: true,
                threads
            });
        }

        const allAgents = await getAgents();

        const allAgentUrls = new Set<string>();
        const unplacedUrls = new Set<string>();
        const unplacedNameByUrl = new Map<string, string>();

        for (const agent of allAgents) {
            if (agent.url) {
                allAgentUrls.add(agent.url);
            }

            if (agent.isPlaced === false && agent.url) {
                unplacedUrls.add(agent.url);
                unplacedNameByUrl.set(agent.url, agent.card.name);
            }
        }

        const results = await Promise.all(
            threadEntries.map(async ([id, thread]) => {
                let hasUnplacedAgents = false;
                const unplacedAgentNameSet = new Set<string>();

                try {
                    const res = await fetch(`${A2A_ORCHESTRATION_BASE_URL}/threads/${thread.id}?userId=${userId}`);

                    if (res.ok) {
                        const data = (await res.json()) as ThreadResponse;
                        const agents = data.thread?.agents || [];

                        for (const agent of agents) {
                            const url = agent.a2aUrl;
                            if (url && (unplacedUrls.has(url) || !allAgentUrls.has(url))) {
                                hasUnplacedAgents = true;
                                const name = agent.name || unplacedNameByUrl.get(url) || url;
                                unplacedAgentNameSet.add(name);
                            }
                        }
                    } else {
                        console.warn(`Failed to fetch orchestration thread ${thread.id}: ${res.status}`);
                    }
                } catch (error) {
                    console.error(`Error fetching orchestration thread ${thread.id}:`, error);
                }

                return {
                    id,
                    thread: {
                        ...thread,
                        hasUnplacedAgents,
                        unplacedAgentNames: Array.from(unplacedAgentNameSet)
                    } as Thread
                };
            })
        );

        return NextResponse.json({
            success: true,
            threads: Object.fromEntries(results.map(({ id, thread }) => [id, thread]))
        });
    } catch (error) {
        console.error('Error getting threads:', error);
        return NextResponse.json({ error: 'Failed to get threads' }, { status: 500 });
    }
}

/**
 * POST /api/threads
 * Save a thread
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { userId, threadName, id, agentNames } = body;

        if (!userId || !threadName || !id || !agentNames) {
            return NextResponse.json({ error: 'userId, threadName, id, and agentNames are required' }, { status: 400 });
        }

        const agentComboId = await generateAgentComboId(agentNames);
        const thread: Thread = {
            id,
            threadName,
            agentNames,
            agentComboId,
            createdAt: new Date().toISOString(),
            lastMessageAt: new Date().toISOString()
        };

        await saveThread(userId, thread);

        return NextResponse.json({
            success: true,
            threadName,
            id
        });
    } catch (error) {
        console.error('Error saving thread:', error);
        return NextResponse.json({ error: 'Failed to save thread' }, { status: 500 });
    }
}
