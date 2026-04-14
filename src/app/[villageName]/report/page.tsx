import Link from "next/link";
import { REPORT_API_BASE_URL } from "@/lib/report";
import type { ReportListResponse, ReportJobSummary } from "@/types/report";
import { ReportListActions } from "@/components/report/ReportListActions";

// FIXME: 데모용 하드코딩 리포트. 리포트 데이터 쌓이면 제거
const DEMO_REPORT: ReportJobSummary = {
  jobId: "09221912-ceae-42f1-9525-e7f50c77a390",
  status: "completed",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  title: "데모 리포트",
  description: "데모용 리포트입니다.",
};

const STATUS_BADGE: Record<string, string> = {
  completed:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  processing:
    "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  pending:
    "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400",
  failed: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

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

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default async function ReportListPage({
  params,
}: {
  params: Promise<{ villageName: string }>;
}) {
  const { villageName } = await params;
  const data = await getReports(villageName);
  // FIXME: 데모 리포트 항상 포함. 리포트 데이터 쌓이면 제거
  const items = [DEMO_REPORT, ...(data?.items ?? [])];

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">Reports</h1>
      </div>

      <ReportListActions villageName={villageName} />

      {items.length === 0 ? (
        <div className="flex min-h-[30vh] items-center justify-center">
          <p className="text-muted-foreground">
            아직 리포트가 없습니다.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const isCompleted = item.status === "completed";
            const badgeClass =
              STATUS_BADGE[item.status] || STATUS_BADGE.pending;

            const card = (
              <div
                className={`rounded-xl border border-border bg-card p-5 transition-colors ${
                  isCompleted
                    ? "cursor-pointer hover:bg-muted"
                    : "pointer-events-none opacity-60"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-base font-semibold text-foreground">
                      {item.title || "Untitled Report"}
                    </h2>
                    {item.description && (
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                        {item.description}
                      </p>
                    )}
                  </div>
                  <span
                    className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${badgeClass}`}
                  >
                    {item.status}
                  </span>
                </div>
                <p className="mt-3 text-xs text-muted-foreground/70">
                  {formatDate(item.createdAt)}
                </p>
              </div>
            );

            if (isCompleted) {
              return (
                <Link
                  key={item.jobId}
                  href={`/${villageName}/report/${item.jobId}`}
                >
                  {card}
                </Link>
              );
            }

            return <div key={item.jobId}>{card}</div>;
          })}
        </div>
      )}
    </>
  );
}
