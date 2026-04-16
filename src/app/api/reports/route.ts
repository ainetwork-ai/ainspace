import { NextRequest, NextResponse } from "next/server";
import { REPORT_API_BASE_URL } from "@/lib/report";
import { hasAdminAccess } from "@/lib/auth/permissions";

export async function POST(request: NextRequest) {
  if (!REPORT_API_BASE_URL) {
    return NextResponse.json(
      { error: "Report server is not configured" },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    const { userId, ...reportParams } = body;

    if (!userId) {
      return NextResponse.json(
        { error: "userId is required" },
        { status: 400 }
      );
    }

    const adminCheck = await hasAdminAccess(userId);
    if (!adminCheck.allowed) {
      return NextResponse.json(
        { error: adminCheck.reason || "Admin access required" },
        { status: 403 }
      );
    }

    const res = await fetch(`${REPORT_API_BASE_URL}/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reportParams),
    });

    if (!res.headers.get("content-type")?.includes("application/json")) {
      return NextResponse.json(
        { error: "Upstream returned non-JSON response" },
        { status: 502 }
      );
    }

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error("Error creating report:", error);
    return NextResponse.json(
      { error: "Failed to create report" },
      { status: 500 }
    );
  }
}
