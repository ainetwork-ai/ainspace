"use client";

import { useState, useRef } from "react";
import { Quote as QuoteIcon } from "lucide-react";
import type { Claim, Quote } from "@/types/report";

function QuotePopover({ claim, quotes }: { claim: Claim; quotes: Quote[] }) {
  return (
    <div className="w-[400px] max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card p-4 text-sm shadow-lg">
      <p className="mb-3">
        <span className="font-medium">#{claim.id.split("-").pop()}</span>{" "}
        <span className="text-muted-foreground">{claim.title}</span>
      </p>
      <div className="max-h-[300px] space-y-2 overflow-y-auto">
        {quotes.map((quote) => (
          <div key={quote.id} className="flex gap-2">
            <QuoteIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/70" />
            <p className="text-muted-foreground">
              {quote.text}
              <span className="text-muted-foreground/50">
                {" "}
                - #{quote.reference.messageId.split("_").pop()}
              </span>
            </p>
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

  const handleMouseEnter = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPosition({
        top: rect.bottom + 8,
        left: Math.min(rect.left, window.innerWidth - 420),
      });
    }
    setIsOpen(true);
  };

  return (
    <>
      <button
        ref={buttonRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setIsOpen(false)}
        className="inline-flex h-7 items-center gap-1 rounded-sm border border-border px-2 text-xs text-muted-foreground transition-colors hover:bg-muted"
      >
        <QuoteIcon className="h-4 w-4 text-muted-foreground/70" />
        {claim.number}
      </button>
      {isOpen && (
        <div
          className="pointer-events-none fixed z-[9999]"
          style={{ top: position.top, left: position.left }}
          onMouseEnter={() => setIsOpen(true)}
          onMouseLeave={() => setIsOpen(false)}
        >
          <div className="pointer-events-auto">
            <QuotePopover claim={claim} quotes={claim.quotes} />
          </div>
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
  const messageIds = claim.quotes.map((q) => q.reference.messageId);

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
