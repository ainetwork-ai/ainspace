import { NextRequest, NextResponse } from "next/server";

const REPORT_API_BASE_URL =
  process.env.DEMO_REPORT_URL || process.env.NEXT_PUBLIC_A2A_ORCHESTRATION_BASE_URL;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;

  if (!REPORT_API_BASE_URL) {
    return NextResponse.json(
      { error: "NEXT_PUBLIC_A2A_ORCHESTRATION_BASE_URL is not configured" },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(
      `${REPORT_API_BASE_URL}/reports/${jobId}?format=full`,
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
