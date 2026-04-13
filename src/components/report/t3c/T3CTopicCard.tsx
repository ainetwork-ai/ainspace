"use client";

import { useState, useMemo } from "react";
import type { Topic, ReportMessage } from "@/types/report";
import { TOPIC_COLORS } from "@/types/report";
import { DotGrid } from "../shared/DotGrid";
import { ClaimItem } from "./ClaimItem";

const stanceToSentiment = (
  stance: string
): "positive" | "negative" | "neutral" =>
  stance === "support"
    ? "positive"
    : stance === "oppose"
      ? "negative"
      : "neutral";

interface T3CTopicCardProps {
  topic: Topic;
  topicIndex: number;
}

export function T3CTopicCard({ topic, topicIndex }: T3CTopicCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showFullDesc, setShowFullDesc] = useState(false);
  const [highlightedMessageIds, setHighlightedMessageIds] = useState<
    Set<string>
  >(new Set());

  const topicColor = TOPIC_COLORS[topicIndex % TOPIC_COLORS.length];
  const claims = topic.claims || [];

  const dotMessages: ReportMessage[] = useMemo(() => {
    if (topic.messages && topic.messages.length > 0) return topic.messages;
    const topicClaims = topic.claims || [];
    const seen = new Set<string>();
    return topicClaims.flatMap((claim) =>
      claim.quotes
        .filter((q) => {
          if (seen.has(q.reference.messageId)) return false;
          seen.add(q.reference.messageId);
          return true;
        })
        .map((q) => ({
          id: q.reference.messageId,
          content: q.text,
          timestamp: 0,
          category: claim.stance,
          subCategory: "",
          intent: "",
          sentiment: stanceToSentiment(claim.stance),
          isSubstantive: true,
        }))
    );
  }, [topic.messages, topic.claims]);

  const summaryText =
    topic.summary?.consensus?.join(" ") || topic.description || "";
  const shouldTruncate = summaryText.length > 150;
  const displayText =
    showFullDesc || !shouldTruncate
      ? summaryText
      : summaryText.slice(0, 150) + "...";

  const handleClaimHover = (messageIds: string[] | null) => {
    setHighlightedMessageIds(messageIds ? new Set(messageIds) : new Set());
  };

  return (
    <div
      id={topic.id}
      className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"
    >
      {/* Header */}
      <div className="px-6 pt-5 pb-0">
        <div className="mb-1 flex items-start justify-between gap-4">
          <h3 className="text-xl font-bold text-foreground">{topic.title}</h3>
          <span className="shrink-0 text-xs text-muted-foreground">
            {claims.length} claims by {dotMessages.length} people
          </span>
        </div>
      </div>

      {/* Dot Grid */}
      {dotMessages.length > 0 && (
        <div className="px-6">
          <DotGrid
            messages={dotMessages}
            topicColor={topicColor}
            highlightedMessageIds={highlightedMessageIds}
          />
        </div>
      )}

      {/* Description */}
      <div className="px-6 pb-4">
        <p className="text-sm leading-relaxed text-muted-foreground">
          {displayText}
          {shouldTruncate && (
            <button
              onClick={() => setShowFullDesc(!showFullDesc)}
              className="ml-1 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
            >
              {showFullDesc ? "Show less" : "Show more"}
            </button>
          )}
        </p>
      </div>

      {/* Expand/Collapse */}
      <div className="flex items-center justify-between px-6 pb-4">
        <span className="text-xs text-muted-foreground/70">
          {claims.length} claims
        </span>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
            isExpanded
              ? "bg-muted text-foreground hover:bg-muted/80"
              : "bg-blue-600 text-white hover:bg-blue-700"
          }`}
        >
          {isExpanded ? "Collapse Topic" : "Expand Topic"}
        </button>
      </div>

      {/* Expanded Claims */}
      {isExpanded && (
        <div className="border-t border-border px-6 py-4">
          <h4 className="mb-3 text-sm font-semibold text-foreground/70">
            Claims
          </h4>
          <div>
            {claims.map((claim, index) => (
              <ClaimItem
                key={claim.id}
                claim={claim}
                index={index}
                color={topicColor}
                onHover={handleClaimHover}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
