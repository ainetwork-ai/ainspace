"use client";
import { useState } from "react";
export function DownloadReportJson({ jobId }: { jobId: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const handleDownload = async () => {
    setPending(true); setError(false);
    try {
      const response = await fetch(`/api/reports/${jobId}`, { signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error('Report unavailable');
      const data = await response.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob); const link = document.createElement("a");
      link.href = url; link.download = `report-${jobId}.json`;
      document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(url);
    } catch { setError(true); } finally { setPending(false); }
  };
  return <div>
    <button onClick={() => void handleDownload()} disabled={pending} className="text-sm text-foreground underline underline-offset-4 transition-colors hover:text-blue-600 disabled:opacity-60 dark:hover:text-blue-400">
      {pending ? '다운로드 준비 중…' : 'Download report in JSON'}
    </button>
    {error && <p role="alert" className="mt-2 text-sm text-red-600">다운로드하지 못했습니다. 다시 시도해 주세요.</p>}
  </div>;
}
