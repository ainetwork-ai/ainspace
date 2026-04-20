"use client";

import { useReportExpanded } from "./ReportExpandedProvider";

export function ReportHeaderControls({ topicIds }: { topicIds: string[] }) {
  const { expandedCount, expandAll, collapseAll } = useReportExpanded();

  if (topicIds.length === 0) return null;

  const allExpanded = expandedCount === topicIds.length;

  return (
    <div className="flex gap-2">
      <button
        onClick={collapseAll}
        disabled={expandedCount === 0}
        className="rounded-md border border-border px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
      >
        Collapse all
      </button>
      <button
        onClick={() => expandAll(topicIds)}
        disabled={allExpanded}
        className="rounded-md border border-border bg-foreground px-3 py-1 text-xs font-medium text-background transition-colors hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Expand all
      </button>
    </div>
  );
}
