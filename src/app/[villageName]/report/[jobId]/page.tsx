import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import type { ReportApiResponse } from "@/types/report";
import { T3CSynthesisSection } from "@/components/report/t3c/T3CSynthesisSection";
import { T3CTopicCard } from "@/components/report/t3c/T3CTopicCard";

// FIXME: DEMO_REPORT_URL은 임시. 프로덕션 리포트 서버 확정 후 제거
const REPORT_API_BASE_URL =
  process.env.DEMO_REPORT_URL || process.env.NEXT_PUBLIC_A2A_ORCHESTRATION_BASE_URL;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getReport(jobId: string): Promise<ReportApiResponse> {
  if (!UUID_REGEX.test(jobId)) {
    throw new Error("Invalid job ID format");
  }

  if (!REPORT_API_BASE_URL) {
    throw new Error("Report server is not configured");
  }

  const res = await fetch(`${REPORT_API_BASE_URL}/reports/${jobId}?format=full`, {
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch report: ${res.status}`);
  }

  return res.json();
}

function formatDateTime(timestamp: number) {
  return new Date(timestamp).toLocaleString("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function ReportPage({
  params,
}: {
  params: Promise<{ villageName: string; jobId: string }>;
}) {
  const { jobId } = await params;

  let data: ReportApiResponse;
  try {
    data = await getReport(jobId);
  } catch (error) {
    console.error("Failed to load report:", error);
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-muted-foreground">
          리포트를 찾을 수 없습니다.
        </p>
      </div>
    );
  }

  const { report } = data;
  const { statistics } = report;

  const displayTitle = data.title ?? report.title;
  const displayDate = report.date
    ? new Date(report.date).getTime()
    : (report.createdAt ?? data.createdAt);

  return (
    <>
      {/* Header */}
      <header className="mb-8">
        <h1 className="mb-2 text-2xl font-bold text-foreground">
          {displayTitle}
        </h1>
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          {report.topics && (
            <>
              <span>{report.topics.length} topics</span>
              <span className="text-muted-foreground/50">·</span>
              <span>
                {report.topics.reduce(
                  (s, t) => s + (t.claims?.length ?? 0),
                  0
                )}{" "}
                claims
              </span>
            </>
          )}
          {statistics.totalThreads > 0 && (
            <>
              <span className="text-muted-foreground/50">·</span>
              <span>{statistics.totalThreads} threads</span>
            </>
          )}
          {displayDate && (
            <>
              <span className="text-muted-foreground/50">·</span>
              <span>{formatDateTime(displayDate)}</span>
            </>
          )}
          {data.tags?.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
      </header>

      {/* Synthesis */}
      {report.synthesis && report.topics && (
        <T3CSynthesisSection
          synthesis={report.synthesis}
          statistics={statistics}
          topics={report.topics}
        />
      )}

      {/* Topic Cards */}
      {report.topics && (
        <section className="mt-8 space-y-6">
          {report.topics.map((topic, index) => (
            <T3CTopicCard
              key={topic.id}
              topic={topic}
              topicIndex={index}
            />
          ))}
        </section>
      )}

      {/* Markdown Report */}
      {report.markdown && (
        <section className="mt-8 rounded-xl border border-border bg-card p-6 shadow-sm md:p-8">
          <h2 className="mb-6 text-lg font-semibold text-foreground">
            Full Report
          </h2>
          <article className="prose dark:prose-invert prose-sm md:prose-base max-w-none">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeSanitize]}
            >
              {report.markdown}
            </ReactMarkdown>
          </article>
        </section>
      )}

      {/* Footer */}
      <footer className="mt-8 border-t border-border pt-6 text-center text-sm text-muted-foreground">
        <p>
          Report ID: {report.id} · Job ID: {data.jobId}
        </p>
      </footer>
    </>
  );
}
