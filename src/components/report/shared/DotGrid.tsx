"use client";

import { useState } from "react";
import type { ReportMessage } from "@/types/report";

export function DotGrid({
  messages,
  topicColor,
  highlightedMessageIds,
}: {
  messages: ReportMessage[];
  topicColor: string;
  highlightedMessageIds: Set<string>;
}) {
  const [hoveredMessage, setHoveredMessage] = useState<ReportMessage | null>(
    null
  );
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const handleMouseEnter = (msg: ReportMessage, e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltipPos({
      x: rect.left + rect.width / 2,
      y: rect.top - 10,
    });
    setHoveredMessage(msg);
  };

  return (
    <div className="dot-grid-container relative py-3">
      <div className="flex flex-wrap gap-0.5">
        {messages.map((msg, i) => {
          const isHighlighted = highlightedMessageIds.has(msg.id);
          const isHovered = hoveredMessage?.id === msg.id;

          return (
            <div
              key={msg.id || i}
              className="h-3 w-3 cursor-pointer rounded-sm border transition-all duration-150"
              style={{
                borderColor:
                  isHighlighted || isHovered
                    ? topicColor
                    : `${topicColor}50`,
                backgroundColor: isHighlighted
                  ? topicColor
                  : isHovered
                    ? `${topicColor}40`
                    : "transparent",
              }}
              onMouseEnter={(e) => handleMouseEnter(msg, e)}
              onMouseLeave={() => setHoveredMessage(null)}
            />
          );
        })}
      </div>

      {hoveredMessage && (
        <div
          className="pointer-events-none fixed z-[9999] max-w-xs rounded-lg bg-card p-3 text-xs text-foreground shadow-lg ring-1 ring-border"
          style={{
            left: tooltipPos.x,
            top: tooltipPos.y,
            transform: "translate(-50%, -100%)",
          }}
        >
          {hoveredMessage.timestamp > 0 && (
            <p className="mb-1 font-medium text-muted-foreground">
              {new Date(hoveredMessage.timestamp).toLocaleDateString("ko-KR")}
            </p>
          )}
          <p className="line-clamp-3">{hoveredMessage.content}</p>
          <div className="mt-2 flex items-center gap-2 text-muted-foreground">
            <span className="capitalize">{hoveredMessage.category}</span>
            <span>-</span>
            <span className="capitalize">{hoveredMessage.sentiment}</span>
          </div>
        </div>
      )}
    </div>
  );
}
