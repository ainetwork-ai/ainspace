export function SentimentBadge({ sentiment }: { sentiment: string }) {
  const colors: Record<string, string> = {
    positive:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    negative:
      "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    neutral:
      "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
  };

  const key = sentiment.toLowerCase();

  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${colors[key] || colors.neutral}`}
    >
      {sentiment}
    </span>
  );
}
