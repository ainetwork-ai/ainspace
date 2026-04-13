"use client";

import {
  useState,
  useEffect,
  createContext,
  useContext,
  useCallback,
} from "react";
import { Check, X, Info } from "lucide-react";

interface Toast {
  id: string;
  message: string;
  type?: "success" | "error" | "info";
}

interface ToastContextType {
  showToast: (message: string, type?: Toast["type"]) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback(
    (message: string, type: Toast["type"] = "success") => {
      const id = Math.random().toString(36).substring(7);
      setToasts((prev) => [...prev, { id, message, type }]);
    },
    []
  );

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onRemove={removeToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({
  toast,
  onRemove,
}: {
  toast: Toast;
  onRemove: (id: string) => void;
}) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setIsVisible(true));

    let fadeTimer: ReturnType<typeof setTimeout>;
    const dismissTimer = setTimeout(() => {
      setIsVisible(false);
      fadeTimer = setTimeout(() => onRemove(toast.id), 200);
    }, 2000);

    return () => {
      clearTimeout(dismissTimer);
      clearTimeout(fadeTimer);
    };
  }, [toast.id, onRemove]);

  const bgColor = {
    success: "bg-emerald-600",
    error: "bg-red-600",
    info: "bg-blue-600",
  }[toast.type || "success"];

  const icon = {
    success: <Check className="h-4 w-4" />,
    error: <X className="h-4 w-4" />,
    info: <Info className="h-4 w-4" />,
  }[toast.type || "success"];

  return (
    <div
      className={`${bgColor} flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-white shadow-lg transition-all duration-200 ${
        isVisible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
      }`}
    >
      {icon}
      {toast.message}
    </div>
  );
}
