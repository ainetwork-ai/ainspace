import { NextRequest, NextResponse } from "next/server";
import { REPORT_API_BASE_URL } from "@/lib/report";
import { isValidUUID } from "@/lib/utils";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;

  if (!isValidUUID(jobId)) {
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
