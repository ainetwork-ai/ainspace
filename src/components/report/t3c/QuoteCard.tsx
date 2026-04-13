import type { Quote } from "@/types/report";

export function QuoteCard({ quote }: { quote: Quote }) {
  return (
    <div className="rounded-lg border border-border bg-muted p-4">
      <p className="whitespace-pre-wrap text-sm text-foreground/70">
        {quote.text}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>Segment: {quote.reference.segmentId.slice(0, 8)}...</span>
      </div>
    </div>
  );
}
