import { NextRequest, NextResponse } from 'next/server';
import { generateAgentResponse } from '@/lib/gemini';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agentData } = body;

    if (!agentData) {
      return NextResponse.json(
        { error: 'Agent data is required' },
        { status: 400 }
      );
    }

    const response = await generateAgentResponse(agentData);

    return NextResponse.json({
      response,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in POST /api/agent-response:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}