import { NextRequest, NextResponse } from "next/server";

// FIXME: DEMO_REPORT_URL은 임시. 프로덕션 리포트 서버 확정 후 제거
const REPORT_API_BASE_URL =
  process.env.DEMO_REPORT_URL || process.env.NEXT_PUBLIC_A2A_ORCHESTRATION_BASE_URL;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;

  if (!UUID_REGEX.test(jobId)) {
    return NextResponse.json(
      { error: "Invalid job ID format" },
      { status: 400 }
    );
  }

  if (!REPORT_API_BASE_URL) {
    return NextResponse.json(
      { error: "Report server is not configured" },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(
      `${REPORT_API_BASE_URL}/reports/${jobId}?format=full`,
      { cache: "no-store" }
    );

    if (!res.headers.get("content-type")?.includes("application/json")) {
      return NextResponse.json(
        { error: "Upstream returned non-JSON response" },
        { status: 502 }
      );
    }

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
