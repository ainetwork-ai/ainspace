"use client";

import type { ReportApiResponse } from "@/types/report";

export function DownloadReportJson({ data }: { data: ReportApiResponse }) {
  const handleDownload = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `report-${data.jobId}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <button
      onClick={handleDownload}
      className="text-sm text-foreground underline underline-offset-4 transition-colors hover:text-blue-600 dark:hover:text-blue-400"
    >
      Download report in JSON
    </button>
  );
}
