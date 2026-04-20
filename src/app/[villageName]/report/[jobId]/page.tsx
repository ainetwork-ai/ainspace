import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import type { ReportApiResponse } from "@/types/report";
import { getTopicClaims } from "@/types/report";
import { REPORT_API_BASE_URL } from "@/lib/report";
import { isValidUUID } from "@/lib/utils";
import { T3CSynthesisSection } from "@/components/report/t3c/T3CSynthesisSection";
import { T3CTopicCard } from "@/components/report/t3c/T3CTopicCard";
import { DownloadReportJson } from "@/components/report/DownloadReportJson";

async function getReport(jobId: string): Promise<ReportApiResponse> {
  if (!isValidUUID(jobId)) {
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
  const { villageName, jobId } = await params;

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

  const claimCounts = new Map(
    (report.topics ?? []).map((t) => [t.id, getTopicClaims(t).length])
  );
  const sortedTopics = report.topics
    ? [...report.topics].sort(
        (a, b) => (claimCounts.get(b.id) ?? 0) - (claimCounts.get(a.id) ?? 0)
      )
    : undefined;
  const totalClaims = sortedTopics
    ? sortedTopics.reduce((s, t) => s + (claimCounts.get(t.id) ?? 0), 0)
    : 0;

  return (
    <>
      {/* Back Navigation */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur -mx-4 -mt-8 mb-8 px-4 py-3">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <Link
            href={`/${villageName}/report`}
            className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Reports</span>
          </Link>
        </div>
      </header>

      {/* Header */}
      <header className="mb-8">
        <h1 className="mb-2 text-2xl font-bold text-foreground">
          {displayTitle}
        </h1>
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          {sortedTopics && (
            <>
              <span>{sortedTopics.length} topics</span>
              <span className="text-muted-foreground/50">·</span>
              <span>
                {totalClaims} claims
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
      {report.synthesis && sortedTopics && (
        <T3CSynthesisSection
          synthesis={report.synthesis}
          statistics={statistics}
          topics={sortedTopics}
        />
      )}

      {/* Topic Cards */}
      {sortedTopics && (
        <section className="mt-8 space-y-6">
          {sortedTopics.map((topic, index) => (
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

      <section className="mt-12">
        <h2 className="mb-2 text-lg font-semibold text-foreground">Appendix</h2>
        <DownloadReportJson data={data} />
      </section>
    </>
  );
}
