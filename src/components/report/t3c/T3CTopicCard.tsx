"use client";

import { useState, useMemo } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { Topic, ReportMessage, Claim, Subtopic } from "@/types/report";
import { TOPIC_COLORS, getTopicClaims } from "@/types/report";
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

function claimsToDotMessages(claims: Claim[]): ReportMessage[] {
  const seen = new Set<string>();
  return claims.flatMap((claim) =>
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
}

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
  const allClaims = useMemo(() => getTopicClaims(topic), [topic]);

  const dotMessages: ReportMessage[] = useMemo(() => {
    if (topic.messages && topic.messages.length > 0) return topic.messages;
    return claimsToDotMessages(allClaims);
  }, [topic.messages, allClaims]);

  const summaryText =
    topic.summary?.text ||
    topic.summary?.consensus?.join(" ") ||
    topic.description ||
    "";
  const shouldTruncate = summaryText.length > 150;
  const displayText =
    showFullDesc || !shouldTruncate
      ? summaryText
      : summaryText.slice(0, 150) + "...";

  const handleClaimHover = (messageIds: string[] | null) => {
    setHighlightedMessageIds(messageIds ? new Set(messageIds) : new Set());
  };

  const hasSubtopics = !!(topic.subtopics && topic.subtopics.length > 0);

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
            {allClaims.length} claims by {dotMessages.length} people
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
          {hasSubtopics
            ? `${topic.subtopics!.length} subtopics · ${allClaims.length} claims`
            : `${allClaims.length} claims`}
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
          {hasSubtopics ? (
            <SubtopicSections
              topic={topic}
              topicColor={topicColor}
              onClaimHover={handleClaimHover}
              highlightedMessageIds={highlightedMessageIds}
            />
          ) : (
            <>
              <h4 className="mb-3 text-sm font-semibold text-foreground/70">
                Claims
              </h4>
              <div>
                {allClaims.map((claim, index) => (
                  <ClaimItem
                    key={claim.id}
                    claim={claim}
                    index={index}
                    color={topicColor}
                    onHover={handleClaimHover}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SubtopicSections({
  topic,
  topicColor,
  onClaimHover,
  highlightedMessageIds,
}: {
  topic: Topic;
  topicColor: string;
  onClaimHover: (messageIds: string[] | null) => void;
  highlightedMessageIds: Set<string>;
}) {
  const indexedSubtopics = useMemo(() => {
    let runningIndex = 0;
    return topic.subtopics!.map((subtopic) => {
      const startIndex = runningIndex;
      runningIndex += subtopic.claims.length;
      return { subtopic, startIndex };
    });
  }, [topic.subtopics]);

  return (
    <div className="divide-y divide-border">
      {indexedSubtopics.map(({ subtopic, startIndex }) => (
        <SubtopicSection
          key={subtopic.id}
          subtopic={subtopic}
          startIndex={startIndex}
          topicColor={topicColor}
          onClaimHover={onClaimHover}
          highlightedMessageIds={highlightedMessageIds}
        />
      ))}
    </div>
  );
}

function SubtopicSection({
  subtopic,
  startIndex,
  topicColor,
  onClaimHover,
  highlightedMessageIds,
}: {
  subtopic: Subtopic;
  startIndex: number;
  topicColor: string;
  onClaimHover: (messageIds: string[] | null) => void;
  highlightedMessageIds: Set<string>;
}) {
  const [isOpen, setIsOpen] = useState(true);

  const dotMessages = useMemo(
    () => claimsToDotMessages(subtopic.claims),
    [subtopic.claims]
  );

  return (
    <section className="py-4 first:pt-0 last:pb-0">
      <button
        onClick={() => setIsOpen((o) => !o)}
        className="group flex w-full items-start justify-between gap-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {isOpen ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <h4 className="text-base font-semibold text-foreground">
              {subtopic.title}
            </h4>
          </div>
          {subtopic.description && (
            <p className="mt-1 ml-6 text-xs leading-relaxed text-muted-foreground">
              {subtopic.description}
            </p>
          )}
        </div>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {subtopic.claims.length} claims
        </span>
      </button>

      {isOpen && (
        <div
          className="mt-3 ml-6 border-l-2 pl-4"
          style={{ borderColor: `${topicColor}40` }}
        >
          {dotMessages.length > 0 && (
            <DotGrid
              messages={dotMessages}
              topicColor={topicColor}
              highlightedMessageIds={highlightedMessageIds}
            />
          )}
          {subtopic.claims.map((claim: Claim, i: number) => (
            <ClaimItem
              key={claim.id}
              claim={claim}
              index={startIndex + i}
              color={topicColor}
              onHover={onClaimHover}
            />
          ))}
        </div>
      )}
    </section>
  );
}
