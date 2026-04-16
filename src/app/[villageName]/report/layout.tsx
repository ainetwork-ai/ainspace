import { ToastProvider } from "@/components/report/Toast";

export default async function ReportLayout({
  children,
}: {
  children: React.ReactNode;
  params: Promise<{ villageName: string }>;
}) {
  return (
    <ToastProvider>
      <div className="min-h-screen bg-background text-foreground">
        {/* Content */}
        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      </div>
    </ToastProvider>
  );
}
