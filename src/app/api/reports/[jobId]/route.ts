import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const baseUrl = process.env.NEXT_PUBLIC_A2A_ORCHESTRATION_BASE_URL;

  if (!baseUrl) {
    return NextResponse.json(
      { error: "NEXT_PUBLIC_A2A_ORCHESTRATION_BASE_URL is not configured" },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(
      `${baseUrl}/reports/${jobId}?format=full`,
      { cache: "no-store" }
    );

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error("Error fetching report:", error);
    return NextResponse.json(
      { error: "Failed to fetch report" },
      { status: 500 }
    );
  }
}
