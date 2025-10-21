import { NextRequest, NextResponse } from 'next/server';
import { generateCommentary } from '@/lib/gemini';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { gameState } = body;

    if (!gameState) {
      return NextResponse.json(
        { error: 'Game state is required' },
        { status: 400 }
      );
    }

    const commentary = await generateCommentary(gameState);

    return NextResponse.json({
      commentary,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in POST /api/commentary:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}