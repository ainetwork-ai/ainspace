"use client";

import Button from "@/components/ui/Button";
import { useReportExpanded } from "./ReportExpandedProvider";

export function ReportHeaderControls({ topicIds }: { topicIds: string[] }) {
  const { expandedCount, expandAll, collapseAll } = useReportExpanded();

  if (topicIds.length === 0) return null;

  const allExpanded = expandedCount === topicIds.length;

  return (
    <div className="flex gap-2">
      <Button
        type="small"
        variant="line"
        onClick={collapseAll}
        disabled={expandedCount === 0}
        className="py-1.5"
      >
        Collapse all
      </Button>
      <Button
        type="small"
        variant="line"
        onClick={() => expandAll(topicIds)}
        disabled={allExpanded}
        className="py-1.5"
      >
        Expand all
      </Button>
    </div>
  );
}
