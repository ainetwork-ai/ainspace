import { ToastProvider } from "@/components/report/Toast";
import { ReportThemeProvider } from "@/components/report/ReportThemeProvider";
import { ReportThemeContainer } from "@/components/report/ReportThemeContainer";

export default async function ReportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ToastProvider>
      <ReportThemeProvider>
        <ReportThemeContainer>
          <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
        </ReportThemeContainer>
      </ReportThemeProvider>
    </ToastProvider>
  );
}
