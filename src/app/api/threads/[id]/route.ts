import { NextRequest, NextResponse } from "next/server";

const A2A_ORCHESTRATION_BASE_URL = process.env.NEXT_PUBLIC_A2A_ORCHESTRATION_BASE_URL;

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const endpoint = `${A2A_ORCHESTRATION_BASE_URL}/threads/${id}/messages?limit=10`;

    try {
        const response = await fetch(endpoint);
        const data = await response.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error('Error getting thread messages:', error);
        return NextResponse.json({ error: 'Failed to get thread messages' }, { status: 500 });
    }
}