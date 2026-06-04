import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { REPORT_API_BASE_URL } from "@/lib/report";
import type { ReportListResponse } from "@/types/report";
import { ReportListActions } from "@/components/report/ReportListActions";
import { ReportListItem } from "@/components/report/ReportListItem";

async function getReports(
  villageName: string
): Promise<ReportListResponse | null> {
  if (!REPORT_API_BASE_URL) return null;

  try {
    const res = await fetch(
      `${REPORT_API_BASE_URL}/reports?tags=village:${villageName}&sortBy=createdAt&sortOrder=desc`,
      { cache: "no-store" }
    );
    if (!res.ok) {
      console.error("Failed to fetch reports:", res.status);
      return null;
    }
    return res.json();
  } catch (error) {
    console.error("Error fetching reports:", error);
    return null;
  }
}

export default async function ReportListPage({
  params,
}: {
  params: Promise<{ villageName: string }>;
}) {
  const { villageName } = await params;
  const data = await getReports(villageName);
  const items = data?.items ?? [];

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur -mx-4 -mt-8 mb-6 px-4 py-3">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <Link
            href={`/?village=${villageName}`}
            className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>{decodeURIComponent(villageName)}</span>
          </Link>
        </div>
      </header>

      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">Reports</h1>
      </div>

      <ReportListActions villageName={villageName} />

      {items.length === 0 ? (
        <div className="flex min-h-[30vh] items-center justify-center">
          <p className="text-muted-foreground">아직 리포트가 없습니다.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <ReportListItem
              key={item.jobId}
              item={item}
              villageName={villageName}
            />
          ))}
        </div>
      )}
    </>
  );
}
