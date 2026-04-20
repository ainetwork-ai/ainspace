"use client";

import Button from "@/components/ui/Button";
import { useReportExpanded } from "./ReportExpandedProvider";
import { useReportIsDark } from "./ReportThemeProvider";

export function ReportHeaderControls({ topicIds }: { topicIds: string[] }) {
  const { expandedCount, expandAll, collapseAll } = useReportExpanded();
  const isDark = useReportIsDark();

  if (topicIds.length === 0) return null;

  const allExpanded = expandedCount === topicIds.length;

  return (
    <div className="flex gap-2">
      <Button
        type="small"
        variant="ghost"
        onClick={collapseAll}
        disabled={expandedCount === 0}
        isDarkMode={isDark}
      >
        Collapse all
      </Button>
      <Button
        type="small"
        variant="primary"
        onClick={() => expandAll(topicIds)}
        disabled={allExpanded}
        isDarkMode={isDark}
      >
        Expand all
      </Button>
    </div>
  );
}
