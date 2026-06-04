"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Pencil, Trash2, Check, X, Loader2 } from "lucide-react";
import { useUserStore } from "@/stores/useUserStore";
import { useToast } from "./Toast";
import { REPORT_API_BASE_URL } from "@/lib/report";
import type { ReportJobSummary } from "@/types/report";

const STATUS_BADGE: Record<string, string> = {
  completed:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  processing:
    "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  pending:
    "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400",
  failed: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function ReportListItem({
  item,
  villageName,
}: {
  item: ReportJobSummary;
  villageName: string;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const checkPermission = useUserStore((s) => s.checkPermission);
  const isAdmin = checkPermission("adminAccess");

  const [isEditing, setIsEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState(item.title || "");
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const isCompleted = item.status === "completed";
  const badgeClass = STATUS_BADGE[item.status] || STATUS_BADGE.pending;
  const canNavigate = isCompleted && !isEditing;

  const stopBubble = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const enterEdit = () => {
    setEditedTitle(item.title || "");
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setEditedTitle(item.title || "");
  };

  const saveTitle = async () => {
    const trimmed = editedTitle.trim();
    if (!trimmed) {
      showToast("제목을 입력해주세요", "error");
      return;
    }
    if (trimmed === (item.title || "")) {
      cancelEdit();
      return;
    }
    if (!REPORT_API_BASE_URL) {
      showToast("리포트 서버가 설정되지 않았습니다", "error");
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch(`${REPORT_API_BASE_URL}/reports/${item.jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to update");
      }
      showToast("제목이 수정되었습니다");
      setIsEditing(false);
      router.refresh();
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : "제목 수정에 실패했습니다",
        "error"
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!REPORT_API_BASE_URL) {
      showToast("리포트 서버가 설정되지 않았습니다", "error");
      return;
    }
    setIsDeleting(true);
    try {
      const res = await fetch(`${REPORT_API_BASE_URL}/reports/${item.jobId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to delete");
      }
      showToast("리포트가 삭제되었습니다");
      setShowDeleteConfirm(false);
      router.refresh();
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : "리포트 삭제에 실패했습니다",
        "error"
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const card = (
    <div
      className={`rounded-xl border border-border bg-card p-5 transition-colors ${
        canNavigate ? "cursor-pointer hover:bg-muted" : ""
      } ${!isCompleted && !isAdmin ? "opacity-60" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {isEditing ? (
            <input
              type="text"
              value={editedTitle}
              onChange={(e) => setEditedTitle(e.target.value)}
              onClick={stopBubble}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  saveTitle();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancelEdit();
                }
              }}
              disabled={isSaving}
              autoFocus
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-base font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
          ) : (
            <h2 className="truncate text-base font-semibold text-foreground">
              {item.title || "Untitled Report"}
            </h2>
          )}
          {item.description && !isEditing && (
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
              {item.description}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span
            className={`rounded px-2 py-0.5 text-xs font-medium ${badgeClass}`}
          >
            {item.status}
          </span>
          {isAdmin && !isEditing && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  stopBubble(e);
                  enterEdit();
                }}
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="제목 수정"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  stopBubble(e);
                  setShowDeleteConfirm(true);
                }}
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                aria-label="리포트 삭제"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </>
          )}
          {isEditing && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  stopBubble(e);
                  saveTitle();
                }}
                disabled={isSaving}
                className="rounded p-1 text-emerald-600 transition-colors hover:bg-emerald-50 disabled:opacity-50 dark:hover:bg-emerald-900/30"
                aria-label="저장"
              >
                {isSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  stopBubble(e);
                  cancelEdit();
                }}
                disabled={isSaving}
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                aria-label="취소"
              >
                <X className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground/70">
        {formatDate(item.createdAt)}
      </p>
    </div>
  );

  return (
    <>
      {canNavigate ? (
        <Link href={`/${villageName}/report/${item.jobId}`}>{card}</Link>
      ) : (
        card
      )}

      {showDeleteConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => {
            if (!isDeleting) setShowDeleteConfirm(false);
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-lg"
          >
            <h3 className="text-base font-semibold text-foreground">
              리포트를 삭제할까요?
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              &quot;{item.title || "Untitled Report"}&quot; 리포트가 삭제됩니다.
              이 작업은 되돌릴 수 없습니다.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeleting}
                className="rounded-md px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={isDeleting}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
              >
                {isDeleting ? "삭제 중..." : "삭제"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
