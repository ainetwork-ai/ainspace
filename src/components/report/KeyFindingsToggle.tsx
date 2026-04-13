"use client";

import { useState } from "react";
import { CheckCircle, ChevronDown } from "lucide-react";

export function KeyFindingsToggle({ findings }: { findings: string[] }) {
  const [isOpen, setIsOpen] = useState(false);

  if (!findings || findings.length === 0) return null;

  return (
    <div className="border-t border-border pt-4">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="group flex w-full items-center gap-2 text-left"
      >
        <CheckCircle className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
        <h3 className="text-sm font-medium text-foreground/70">
          Key Findings
        </h3>
        <span className="text-xs text-muted-foreground/70">
          ({findings.length})
        </span>
        <ChevronDown
          className={`ml-auto h-4 w-4 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>
      {isOpen && (
        <ul className="mt-3 space-y-2 pl-7">
          {findings.map((finding, idx) => (
            <li key={idx} className="flex items-start gap-2 text-sm">
              <span className="mt-0.5 text-emerald-500 dark:text-emerald-400">
                •
              </span>
              <span className="text-muted-foreground">{finding}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
