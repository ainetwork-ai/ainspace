"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type ReportExpandedContextValue = {
  isExpanded: (id: string) => boolean;
  setExpanded: (id: string, expanded: boolean) => void;
  expandAll: (ids: string[]) => void;
  collapseAll: () => void;
  expandedCount: number;
};

const ReportExpandedContext =
  createContext<ReportExpandedContextValue | null>(null);

export function ReportExpandedProvider({ children }: { children: ReactNode }) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const setExpanded = useCallback((id: string, expanded: boolean) => {
    setExpandedIds((prev) => {
      if (expanded === prev.has(id)) return prev;
      const next = new Set(prev);
      if (expanded) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const expandAll = useCallback((ids: string[]) => {
    setExpandedIds((prev) => {
      if (prev.size === ids.length && ids.every((id) => prev.has(id))) {
        return prev;
      }
      return new Set(ids);
    });
  }, []);

  const collapseAll = useCallback(() => {
    setExpandedIds((prev) => (prev.size === 0 ? prev : new Set()));
  }, []);

  const value = useMemo<ReportExpandedContextValue>(
    () => ({
      isExpanded: (id) => expandedIds.has(id),
      setExpanded,
      expandAll,
      collapseAll,
      expandedCount: expandedIds.size,
    }),
    [expandedIds, setExpanded, expandAll, collapseAll]
  );

  return (
    <ReportExpandedContext.Provider value={value}>
      {children}
    </ReportExpandedContext.Provider>
  );
}

export function useReportExpanded() {
  const ctx = useContext(ReportExpandedContext);
  if (!ctx) {
    throw new Error(
      "useReportExpanded must be used within ReportExpandedProvider"
    );
  }
  return ctx;
}
