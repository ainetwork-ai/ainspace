"use client";

import type { Topic } from "@/types/report";
import { T3CTopicCard } from "./t3c/T3CTopicCard";
import { useReportExpanded } from "./ReportExpandedProvider";

export function TopicList({ topics }: { topics: Topic[] }) {
  const { isExpanded, setExpanded } = useReportExpanded();

  return (
    <section className="mt-8 space-y-6">
      {topics.map((topic, index) => (
        <T3CTopicCard
          key={topic.id}
          topic={topic}
          topicIndex={index}
          isExpanded={isExpanded(topic.id)}
          onToggleExpanded={(expanded) => setExpanded(topic.id, expanded)}
        />
      ))}
    </section>
  );
}
