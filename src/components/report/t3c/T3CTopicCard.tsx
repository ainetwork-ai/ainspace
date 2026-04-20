"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import type { Topic, ReportMessage, Claim, Subtopic } from "@/types/report";
import { TOPIC_COLORS, getTopicClaims } from "@/types/report";
import Button from "@/components/ui/Button";
import { useReportIsDark } from "../ReportThemeProvider";
import { DotGrid } from "../shared/DotGrid";
import { TruncatedText } from "../shared/TruncatedText";
import { ClaimItem } from "./ClaimItem";

const DEFAULT_SUBTOPICS_SHOWN = 2;
const DEFAULT_CLAIMS_SHOWN = 10;
const CLAIMS_STEP = 9;

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
  isExpanded: boolean;
  onToggleExpanded: (expanded: boolean) => void;
}

export function T3CTopicCard({
  topic,
  topicIndex,
  isExpanded,
  onToggleExpanded,
}: T3CTopicCardProps) {
  const [highlightedMessageIds, setHighlightedMessageIds] = useState<
    Set<string>
  >(new Set());
  const [scrollTargetId, setScrollTargetId] = useState<string | null>(null);
  const clearScrollTarget = useCallback(() => setScrollTargetId(null), []);
  const isDark = useReportIsDark();

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

  const handleClaimHover = (messageIds: string[] | null) => {
    setHighlightedMessageIds(messageIds ? new Set(messageIds) : new Set());
  };

  const hasSubtopics = !!(topic.subtopics && topic.subtopics.length > 0);

  return (
    <div
      id={topic.id}
      className="scroll-mt-20 overflow-hidden rounded-xl border border-border bg-card shadow-sm"
    >
      <div className="px-6 pt-5 pb-0">
        <div className="mb-1 flex items-start justify-between gap-4">
          <h3 className="text-xl font-bold text-foreground">{topic.title}</h3>
          <span className="shrink-0 text-xs text-muted-foreground">
            {allClaims.length} claims by {dotMessages.length} people
          </span>
        </div>
      </div>

      {dotMessages.length > 0 && (
        <div className="px-6">
          <DotGrid
            messages={dotMessages}
            topicColor={topicColor}
            highlightedMessageIds={highlightedMessageIds}
          />
        </div>
      )}

      <div className="px-6 pb-4">
        <TruncatedText
          text={summaryText}
          className="text-sm leading-relaxed text-muted-foreground"
        />
      </div>

      <div className="flex items-start justify-between gap-4 px-6 pb-4">
        {hasSubtopics ? (
          <p className="flex-1 text-xs text-muted-foreground/80">
            <span className="mr-1 font-medium text-muted-foreground">
              {topic.subtopics!.length} subtopics
            </span>
            {topic.subtopics!.map((s, i) => (
              <span key={s.id}>
                <a
                  href={`#${s.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    setScrollTargetId(s.id);
                    if (!isExpanded) onToggleExpanded(true);
                  }}
                  className="underline-offset-2 hover:text-foreground hover:underline"
                >
                  {s.title}
                </a>
                {i < topic.subtopics!.length - 1 && ", "}
              </span>
            ))}
          </p>
        ) : (
          <span className="text-xs text-muted-foreground/70">
            {allClaims.length} claims
          </span>
        )}
        <Button
          type="small"
          variant={isExpanded ? "ghost" : "primary"}
          onClick={() => onToggleExpanded(!isExpanded)}
          isDarkMode={isDark}
          className="shrink-0 py-1.5"
        >
          {isExpanded ? "Collapse Topic" : "Expand Topic"}
        </Button>
      </div>

      {isExpanded && (
        <div className="border-t border-border px-6 py-4">
          {hasSubtopics ? (
            <SubtopicSections
              topic={topic}
              topicColor={topicColor}
              onClaimHover={handleClaimHover}
              highlightedMessageIds={highlightedMessageIds}
              scrollTargetId={scrollTargetId}
              onScrollComplete={clearScrollTarget}
            />
          ) : (
            <>
              <h4 className="mb-3 text-sm font-semibold text-foreground/70">
                Claims
              </h4>
              {allClaims.map((claim, index) => (
                <ClaimItem
                  key={claim.id}
                  claim={claim}
                  index={index}
                  color={topicColor}
                  onHover={handleClaimHover}
                />
              ))}
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
  scrollTargetId,
  onScrollComplete,
}: {
  topic: Topic;
  topicColor: string;
  onClaimHover: (messageIds: string[] | null) => void;
  highlightedMessageIds: Set<string>;
  scrollTargetId: string | null;
  onScrollComplete: () => void;
}) {
  const isDark = useReportIsDark();
  const [showAll, setShowAll] = useState(false);

  const indexedSubtopics = useMemo(() => {
    let runningIndex = 0;
    return topic.subtopics!.map((subtopic) => {
      const startIndex = runningIndex;
      runningIndex += subtopic.claims.length;
      return { subtopic, startIndex };
    });
  }, [topic.subtopics]);

  const targetIndex = scrollTargetId
    ? indexedSubtopics.findIndex((s) => s.subtopic.id === scrollTargetId)
    : -1;
  const targetHidden =
    targetIndex >= DEFAULT_SUBTOPICS_SHOWN && !showAll;

  useEffect(() => {
    if (!scrollTargetId) return;
    if (targetHidden) {
      setShowAll(true);
      return;
    }
    requestAnimationFrame(() => {
      document
        .getElementById(scrollTargetId)
        ?.scrollIntoView({ block: "start" });
      history.replaceState(null, "", `#${scrollTargetId}`);
      onScrollComplete();
    });
  }, [scrollTargetId, targetHidden, onScrollComplete]);

  const visible = showAll
    ? indexedSubtopics
    : indexedSubtopics.slice(0, DEFAULT_SUBTOPICS_SHOWN);
  const hiddenCount = indexedSubtopics.length - DEFAULT_SUBTOPICS_SHOWN;

  return (
    <div className="space-y-4">
      {visible.map(({ subtopic, startIndex }) => (
        <SubtopicSection
          key={subtopic.id}
          subtopic={subtopic}
          startIndex={startIndex}
          topicColor={topicColor}
          onClaimHover={onClaimHover}
          highlightedMessageIds={highlightedMessageIds}
        />
      ))}
      {!showAll && hiddenCount > 0 && (
        <Button
          type="small"
          variant="ghost"
          onClick={() => setShowAll(true)}
          isDarkMode={isDark}
          className="py-2"
        >
          {hiddenCount} more {hiddenCount === 1 ? "subtopic" : "subtopics"}
        </Button>
      )}
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
  const isDark = useReportIsDark();
  const [claimsShown, setClaimsShown] = useState(DEFAULT_CLAIMS_SHOWN);

  const dotMessages = useMemo(
    () => claimsToDotMessages(subtopic.claims),
    [subtopic.claims]
  );

  const visibleClaims = subtopic.claims.slice(0, claimsShown);
  const hiddenClaimCount = subtopic.claims.length - claimsShown;

  return (
    <section
      id={subtopic.id}
      className="scroll-mt-20 rounded-xl border border-border bg-background p-5"
    >
      <div className="mb-1 flex items-start justify-between gap-4">
        <h4 className="text-base font-semibold text-foreground">
          {subtopic.title}
        </h4>
        <span className="shrink-0 text-xs text-muted-foreground">
          {subtopic.claims.length} claims by {dotMessages.length} people
        </span>
      </div>

      {dotMessages.length > 0 && (
        <DotGrid
          messages={dotMessages}
          topicColor={topicColor}
          highlightedMessageIds={highlightedMessageIds}
        />
      )}

      {subtopic.description && (
        <TruncatedText
          text={subtopic.description}
          className="mt-2 text-sm leading-relaxed text-muted-foreground"
        />
      )}

      <h5 className="mt-4 mb-2 text-sm font-semibold text-foreground/70">
        Claims
      </h5>
      {visibleClaims.map((claim: Claim, i: number) => (
        <ClaimItem
          key={claim.id}
          claim={claim}
          index={startIndex + i}
          color={topicColor}
          onHover={onClaimHover}
        />
      ))}
      {hiddenClaimCount > 0 && (
        <Button
          type="small"
          variant="ghost"
          onClick={() => setClaimsShown((n) => n + CLAIMS_STEP)}
          isDarkMode={isDark}
          className="mt-3 py-2"
        >
          {hiddenClaimCount} more {hiddenClaimCount === 1 ? "claim" : "claims"}
        </Button>
      )}
    </section>
  );
}
