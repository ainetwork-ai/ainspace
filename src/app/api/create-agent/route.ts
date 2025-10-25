import { NextRequest, NextResponse } from 'next/server';

const BUILDER_URL = 'https://a2a-builder.ainetwork.ai';

/**
 * POST /api/create-agent
 * Create and deploy an agent using AI prompt
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { prompt } = body;

        if (!prompt) {
            return NextResponse.json(
                { error: 'Prompt is required' },
                { status: 400 }
            );
        }

        // 1. Generate agent config from prompt
        const generateRes = await fetch(`${BUILDER_URL}/api/generate-agent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt })
        });

        if (!generateRes.ok) {
            const errorText = await generateRes.text();
            console.error('Failed to generate agent:', errorText);
            return NextResponse.json(
                { error: 'Failed to generate agent configuration' },
                { status: generateRes.status }
            );
        }

        const agentConfig = await generateRes.json();

        // 2. Add required fields to AgentConfig
        const agentId = `agent-${Date.now()}`;
        const fullConfig = {
            ...agentConfig,
            id: agentId,
            url: `${BUILDER_URL}/api/agents/${agentId}`,
            protocolVersion: '0.1',
            version: '1.0.0',
            capabilities: {},
            defaultInputModes: ['text'],
            defaultOutputModes: ['text']
        };

        // 3. Deploy agent
        const deployRes = await fetch(`${BUILDER_URL}/api/deploy-agent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fullConfig)
        });

        if (!deployRes.ok) {
            const errorText = await deployRes.text();
            console.error('Failed to deploy agent:', errorText);
            return NextResponse.json(
                { error: 'Failed to deploy agent' },
                { status: deployRes.status }
            );
        }

        const deployed = await deployRes.json();
        const a2aUrl = `${deployed.url}/.well-known/agent.json`;

        console.log('✅ Agent created successfully:', a2aUrl);

        return NextResponse.json({
            success: true,
            url: a2aUrl,
            agentId,
            config: fullConfig
        });
    } catch (error) {
        console.error('Error creating agent:', error);
        return NextResponse.json(
            {
                error: 'Failed to create agent',
                details: error instanceof Error ? error.message : 'Unknown error'
            },
            { status: 500 }
        );
    }
}
