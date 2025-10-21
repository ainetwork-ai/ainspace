import { NextRequest, NextResponse } from 'next/server';
import { A2AClient } from '@a2a-js/sdk/client';

export async function POST(request: NextRequest) {
  try {
    const { agentUrl } = await request.json();
    
    if (!agentUrl) {
      return NextResponse.json(
        { error: 'Agent URL is required' },
        { status: 400 }
      );
    }

    console.log(`Creating A2A client from card URL: ${agentUrl}`);

    // Create A2A client from card URL on the server side
    const client = await A2AClient.fromCardUrl(agentUrl);
    
    // Get the agent card from the client
    const agentCard = await client.getAgentCard();

    console.log(`Successfully created A2A client for agent: ${agentCard.name}`);

    // Return the agent card data and a success indicator
    return NextResponse.json({ 
      agentCard,
      success: true,
      agentUrl
    });

  } catch (error) {
    console.error('Error fetching agent card:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch agent card' },
      { status: 500 }
    );
  }
}