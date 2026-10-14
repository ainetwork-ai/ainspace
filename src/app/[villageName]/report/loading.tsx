export default function ReportLoading() {
  return <div role="status" aria-live="polite" className="flex min-h-[40vh] items-center justify-center gap-3 text-muted-foreground">
    <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-r-transparent" />리포트를 불러오는 중…
  </div>;
}
