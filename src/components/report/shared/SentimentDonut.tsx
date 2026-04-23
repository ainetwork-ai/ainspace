export function SentimentDonut({
  distribution,
}: {
  distribution: { positive: number; negative: number; neutral: number };
}) {
  const total =
    distribution.positive + distribution.negative + distribution.neutral;
  if (total === 0) return null;

  const posPercent = (distribution.positive / total) * 100;
  const negPercent = (distribution.negative / total) * 100;
  const neuPercent = (distribution.neutral / total) * 100;

  const radius = 40;
  const circumference = 2 * Math.PI * radius;

  const posLength = (posPercent / 100) * circumference;
  const negLength = (negPercent / 100) * circumference;
  const neuLength = (neuPercent / 100) * circumference;

  const posOffset = 0;
  const negOffset = -posLength;
  const neuOffset = -(posLength + negLength);

  return (
    <div className="flex items-center gap-3">
      <svg
        width="48"
        height="48"
        viewBox="0 0 100 100"
        className="-rotate-90"
      >
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          className="stroke-border"
          strokeWidth="10"
        />
        {neuPercent > 0 && (
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke="#9ca3af"
            strokeWidth="10"
            strokeDasharray={`${neuLength} ${circumference - neuLength}`}
            strokeDashoffset={neuOffset}
            strokeLinecap="round"
          />
        )}
        {negPercent > 0 && (
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke="#ef4444"
            strokeWidth="10"
            strokeDasharray={`${negLength} ${circumference - negLength}`}
            strokeDashoffset={negOffset}
            strokeLinecap="round"
          />
        )}
        {posPercent > 0 && (
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke="#22c55e"
            strokeWidth="10"
            strokeDasharray={`${posLength} ${circumference - posLength}`}
            strokeDashoffset={posOffset}
            strokeLinecap="round"
          />
        )}
      </svg>
      <div className="flex flex-col gap-0.5 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-green-500" />
          <span className="text-muted-foreground">
            {Math.round(posPercent)}% positive
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-red-500" />
          <span className="text-muted-foreground">
            {Math.round(negPercent)}% negative
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-gray-400" />
          <span className="text-muted-foreground">
            {Math.round(neuPercent)}% neutral
          </span>
        </div>
      </div>
    </div>
  );
}
