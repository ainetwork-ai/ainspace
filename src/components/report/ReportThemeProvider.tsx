"use client";

import { createContext, useContext, type ReactNode } from "react";
import { usePrefersDark } from "@/hooks/usePrefersDark";

const ReportThemeContext = createContext<boolean>(false);

export function ReportThemeProvider({ children }: { children: ReactNode }) {
  const isDark = usePrefersDark();
  return (
    <ReportThemeContext.Provider value={isDark}>
      {children}
    </ReportThemeContext.Provider>
  );
}

export function useReportIsDark() {
  return useContext(ReportThemeContext);
}
