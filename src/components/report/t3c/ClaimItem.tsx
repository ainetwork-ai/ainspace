"use client";

import { useState, useRef, useMemo } from "react";
import { Quote as QuoteIcon } from "lucide-react";
import type { Claim, Quote } from "@/types/report";

function QuotePopover({ claim, quotes }: { claim: Claim; quotes: Quote[] }) {
  return (
    <div className="w-[420px] max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card p-4 text-sm shadow-lg">
      <p className="mb-3">
        <span className="font-medium">#{claim.id.split("-").pop()}</span>{" "}
        <span className="text-muted-foreground">{claim.title}</span>
      </p>
      <div className="max-h-[400px] space-y-4 overflow-y-auto">
        {quotes.map((quote) => (
          <div key={quote.id}>
            {/* Conversation context */}
            {quote.context && quote.context.length > 0 ? (
              <div className="space-y-1.5 rounded-md bg-muted/50 p-3">
                {quote.context.map((msg) => (
                  <div key={msg.id} className="flex gap-2">
                    <span
                      className={`shrink-0 text-xs font-medium ${
                        msg.isUser
                          ? "text-blue-600 dark:text-blue-400"
                          : "text-purple-600 dark:text-purple-400"
                      }`}
                    >
                      {msg.isUser ? "User" : msg.speaker}
                    </span>
                    <p
                      className={`text-xs leading-relaxed ${
                        msg.content === quote.text
                          ? "font-medium text-foreground"
                          : "text-muted-foreground"
                      }`}
                    >
                      {msg.content}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              /* Fallback: quote text only */
              <div className="flex gap-2">
                <QuoteIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/70" />
                <p className="text-muted-foreground">{quote.text}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function QuoteBubble({ claim }: { claim: Claim }) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(null);

  const open = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPosition({
        top: rect.bottom + 8,
        left: Math.min(rect.left, window.innerWidth - 420),
      });
    }
    setIsOpen(true);
  };

  const scheduleClose = () => {
    closeTimer.current = setTimeout(() => setIsOpen(false), 150);
  };

  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  };

  return (
    <>
      <button
        ref={buttonRef}
        onMouseEnter={open}
        onMouseLeave={scheduleClose}
        className="inline-flex h-7 items-center gap-1 rounded-sm border border-border px-2 text-xs text-muted-foreground transition-colors hover:bg-muted"
      >
        <QuoteIcon className="h-4 w-4 text-muted-foreground/70" />
        {claim.number}
      </button>
      {isOpen && (
        <div
          className="fixed z-[9999]"
          style={{ top: position.top, left: position.left }}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <QuotePopover claim={claim} quotes={claim.quotes} />
        </div>
      )}
    </>
  );
}

export function ClaimItem({
  claim,
  index,
  color,
  onHover,
}: {
  claim: Claim;
  index: number;
  color: string;
  onHover: (messageIds: string[] | null) => void;
}) {
  const messageIds = useMemo(
    () => claim.quotes.map((q) => q.reference.messageId),
    [claim.quotes]
  );

  return (
    <div
      id={claim.id}
      className="flex items-start gap-3 border-b border-border py-2.5 last:border-0"
      onMouseEnter={() => onHover(messageIds)}
      onMouseLeave={() => onHover(null)}
    >
      <p className="min-w-0 flex-1 text-sm text-foreground/70">
        <span className="font-medium text-foreground">#{index + 1}</span>{" "}
        {claim.title}
      </p>

      {claim.quotes.length > 0 && <QuoteBubble claim={claim} />}
    </div>
  );
}
