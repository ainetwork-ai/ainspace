"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { useUserStore } from "@/stores/useUserStore";
import { CreateReportForm } from "./CreateReportForm";

export function ReportListActions({ villageName }: { villageName: string }) {
  const router = useRouter();
  const isAdmin = useUserStore((s) => s.checkPermission("adminAccess"));
  const [showForm, setShowForm] = useState(false);

  if (!isAdmin) return null;

  return (
    <>
      {showForm ? (
        <CreateReportForm
          villageName={villageName}
          onCreated={() => {
            setShowForm(false);
            router.refresh();
          }}
          onCancel={() => setShowForm(false)}
        />
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          Create Report
        </button>
      )}
    </>
  );
}
