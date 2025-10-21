import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // Test fetching the agent card directly
    const testUrl = 'https://socratic-web3-ai-tutor.vercel.app/api/a2a/.well-known/agent.json';

    console.log(`Testing direct fetch of: ${testUrl}`);

    const response = await fetch(testUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'AINSpace-Test/1.0',
      },
    });

    console.log(`Status: ${response.status}`);
    console.log(`Headers:`, Object.fromEntries(response.headers.entries()));

    const text = await response.text();
    console.log(`Response text (first 500 chars): ${text.substring(0, 500)}`);

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: 'Failed to parse JSON', text: text.substring(0, 1000) };
    }

    return NextResponse.json({
      url: testUrl,
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      data
    });

  } catch (error) {
    console.error('Test fetch error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Test failed' },
      { status: 500 }
    );
  }
}