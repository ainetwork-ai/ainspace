"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { useUserStore } from "@/stores/useUserStore";
import { useAccount } from "wagmi";
import { CreateReportForm } from "./CreateReportForm";

export function ReportListActions({ villageName }: { villageName: string }) {
  const router = useRouter();
  const { address } = useAccount();
  const { checkPermission, permissions, verifyPermissions } = useUserStore();
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    if (address && !permissions) {
      verifyPermissions(address);
    }
  }, [address, permissions, verifyPermissions]);

  if (!checkPermission("adminAccess")) return null;

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
