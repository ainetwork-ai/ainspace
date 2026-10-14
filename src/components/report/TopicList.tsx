"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Topic, ReportApiResponse } from "@/types/report";
import { T3CTopicCard } from "./t3c/T3CTopicCard";
import { useReportExpanded } from "./ReportExpandedProvider";

export function TopicList({ topics, jobId, claimCounts }: { topics: Topic[]; jobId: string; claimCounts: Record<string, number> }) {
  const { isExpanded, setExpanded, expandedCount } = useReportExpanded();
  const [fullTopics, setFullTopics] = useState<Topic[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const loadDetails = useCallback(async () => {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller; setError(null);
    try {
      const response = await fetch(`/api/reports/${jobId}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]) });
      if (!response.ok) throw new Error('Report unavailable');
      const data = await response.json() as ReportApiResponse;
      if (data.jobId !== jobId || !Array.isArray(data.report?.topics)) throw new Error('Invalid report');
      setFullTopics(data.report.topics);
    } catch {
      if (!controller.signal.aborted) setError('상세 내용을 불러오지 못했습니다. 다시 시도해 주세요.');
    } finally { if (request.current === controller) request.current = null; }
  }, [jobId]);
  useEffect(() => {
    if (expandedCount > 0 && !fullTopics && !error) void loadDetails();
  }, [expandedCount, fullTopics, error, loadDetails]);
  useEffect(() => () => request.current?.abort(), []);
  const byId = new Map(fullTopics?.map(topic => [topic.id, topic]));
  return <section className="mt-8 space-y-6">
    {error && <div role="alert" className="rounded-lg border border-border p-4 text-sm">
      <p>{error}</p><button onClick={() => void loadDetails()} className="mt-2 underline">다시 시도</button>
    </div>}
    {topics.map((topic, index) => <T3CTopicCard key={topic.id} topic={byId.get(topic.id) ?? topic} topicIndex={index}
      claimCount={claimCounts[topic.id]} detailsLoading={!fullTopics} detailsError={!!error}
      isExpanded={isExpanded(topic.id)} onToggleExpanded={expanded => setExpanded(topic.id, expanded)} />)}
  </section>;
}
