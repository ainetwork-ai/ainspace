"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useReportIsDark } from "./ReportThemeProvider";

export function ReportThemeContainer({ children }: { children: ReactNode }) {
  const isDark = useReportIsDark();
  return (
    <div
      className={cn(
        "min-h-screen bg-background text-foreground",
        isDark && "dark"
      )}
    >
      {children}
    </div>
  );
}
