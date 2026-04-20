"use client";

import { useState } from "react";

export function TruncatedText({
  text,
  limit = 150,
  className,
}: {
  text: string;
  limit?: number;
  className?: string;
}) {
  const [showFull, setShowFull] = useState(false);
  const shouldTruncate = text.length > limit;
  const display =
    showFull || !shouldTruncate ? text : text.slice(0, limit) + "...";

  return (
    <p className={className}>
      {display}
      {shouldTruncate && (
        <button
          onClick={() => setShowFull(!showFull)}
          className="ml-1 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
        >
          {showFull ? "Show less" : "Show more"}
        </button>
      )}
    </p>
  );
}
