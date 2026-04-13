import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ToastProvider } from "@/components/report/Toast";

export default async function ReportLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ villageName: string }>;
}) {
  const { villageName } = await params;
  const decodedVillageName = decodeURIComponent(villageName);

  return (
    <ToastProvider>
      <div className="min-h-screen bg-background text-foreground">
        {/* Fixed Header */}
        <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
            <Link
              href="/"
              className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>{decodedVillageName}</span>
            </Link>
          </div>
        </header>

        {/* Content */}
        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      </div>
    </ToastProvider>
  );
}
