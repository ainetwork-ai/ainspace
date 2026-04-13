import { ChevronRight } from "lucide-react";
import type {
  ReportSynthesis,
  ReportStatistics,
  Topic,
} from "@/types/report";
import { TOPIC_COLORS } from "@/types/report";

export function T3CSynthesisSection({
  synthesis,
  statistics,
  topics,
}: {
  synthesis: ReportSynthesis;
  statistics: ReportStatistics;
  topics: Topic[];
}) {
  const totalClaims = topics.reduce(
    (sum, t) => sum + (t.claims?.length ?? 0),
    0
  );

  return (
    <>
      {/* Summary */}
      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold text-foreground">Summary</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {synthesis.executiveSummary}
        </p>
        {synthesis.keyFindings && synthesis.keyFindings.length > 0 && (
          <ul className="mt-4 space-y-1.5">
            {synthesis.keyFindings.map((finding, i) => (
              <li
                key={i}
                className="flex items-start gap-2 text-sm text-muted-foreground"
              >
                <span className="mt-0.5 text-muted-foreground/70">-</span>
                <span>{finding}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Overview — topic list with progress bars */}
      <section className="mb-8">
        <h2 className="mb-4 text-xl font-semibold text-foreground">
          Overview
        </h2>
        <div className="space-y-0">
          {topics.map((topic, index) => {
            const claimCount = topic.claims?.length ?? 0;
            const pct =
              totalClaims > 0 ? (claimCount / totalClaims) * 100 : 0;
            const color = TOPIC_COLORS[index % TOPIC_COLORS.length];

            return (
              <a
                key={topic.id}
                href={`#${topic.id}`}
                className="group flex items-center gap-3 border-b border-border py-2.5 transition-colors hover:bg-muted"
              >
                <span className="min-w-0 max-w-[240px] flex-shrink-0 truncate text-sm font-medium text-foreground">
                  {topic.title ?? topic.name}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground/70">
                  {claimCount} claims
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${pct}%`, backgroundColor: color }}
                  />
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
              </a>
            );
          })}
        </div>
      </section>
    </>
  );
}
