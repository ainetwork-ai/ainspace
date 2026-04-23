"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { useAccount } from "wagmi";
import { useToast } from "./Toast";
import { useUserStore } from "@/stores/useUserStore";

interface CreateReportFormProps {
  villageName: string;
  onCreated: () => void;
  onCancel: () => void;
}

interface AgentInfo {
  url: string;
  card: { name: string };
}

const inputCls =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring";

export function CreateReportForm({
  villageName,
  onCreated,
  onCancel,
}: CreateReportFormProps) {
  const { showToast } = useToast();
  const { address } = useAccount();
  const getUserId = useUserStore((s) => s.getUserId);
  const sessionId = useUserStore((s) => s.sessionId);
  const initSessionId = useUserStore((s) => s.initSessionId);

  useEffect(() => {
    if (!sessionId) initSessionId();
  }, [sessionId, initSessionId]);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [agentNames, setAgentNames] = useState<string[]>([]);
  const [agentInput, setAgentInput] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [language, setLanguage] = useState("ko");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    async function loadAgents() {
      try {
        const res = await fetch(`/api/agents?villages=${villageName}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = await res.json();
        const names = (data.agents || []).map(
          (a: AgentInfo) => a.card?.name
        ).filter(Boolean) as string[];
        setAgentNames([...new Set(names)]);
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return;
      }
    }
    loadAgents();
    return () => controller.abort();
  }, [villageName]);

  const removeAgent = (name: string) => {
    setAgentNames((prev) => prev.filter((n) => n !== name));
  };

  const addAgent = () => {
    const name = agentInput.trim();
    if (name && !agentNames.includes(name)) {
      setAgentNames((prev) => [...prev, name]);
    }
    setAgentInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addAgent();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      showToast("제목을 입력해주세요", "error");
      return;
    }

    const userId = address || getUserId();
    if (!userId) {
      showToast("사용자 인증이 필요합니다", "error");
      return;
    }

    setIsSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        userId,
        title: title.trim(),
        agentNames,
        language,
        timezone: "Asia/Seoul",
        tags: [`village:${villageName}`],
      };
      if (description.trim()) body.description = description.trim();
      if (startDate) body.startDate = new Date(startDate).toISOString();
      if (endDate) body.endDate = new Date(endDate).toISOString();

      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to create report");
      }

      showToast("리포트 생성이 요청되었습니다");
      onCreated();
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "리포트 생성에 실패했습니다",
        "error"
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-6 rounded-xl border border-border bg-card p-6"
    >
      <h2 className="mb-4 text-lg font-semibold text-foreground">
        Create Report
      </h2>

      <div className="space-y-4">
        {/* Title */}
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">
            제목 *
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={inputCls}
            placeholder="리포트 제목"
          />
        </div>

        {/* Description */}
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">
            설명
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className={inputCls}
            placeholder="리포트 설명 (선택)"
          />
        </div>

        {/* Agents */}
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">
            에이전트
          </label>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {agentNames.map((name) => (
              <span
                key={name}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground"
              >
                {name}
                <button
                  type="button"
                  onClick={() => removeAgent(name)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
          <input
            type="text"
            value={agentInput}
            onChange={(e) => setAgentInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className={inputCls}
            placeholder="에이전트 이름 입력 후 Enter"
          />
        </div>

        {/* Date Range */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              시작일
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              종료일
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>

        {/* Language */}
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">
            언어
          </label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="ko">한국어</option>
            <option value="en">English</option>
          </select>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-6 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
        >
          취소
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          {isSubmitting ? "생성 중..." : "생성"}
        </button>
      </div>
    </form>
  );
}
