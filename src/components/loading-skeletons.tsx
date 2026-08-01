import { Skeleton } from "@/components/ui/skeleton";

type SkeletonProps = { className?: string };

function LoadingFrame({
  children,
  className = "",
}: SkeletonProps & { children: React.ReactNode }) {
  return (
    <div
      className={className}
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">جارٍ التحميل…</span>
      {children}
    </div>
  );
}

function DashboardHeaderSkeleton() {
  return (
    <div className="dashboard-page-header">
      <div className="w-full max-w-2xl space-y-3">
        <Skeleton className="h-8 w-44 sm:h-10" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
    </div>
  );
}

export function InboxSkeleton() {
  return (
    <LoadingFrame className="flex h-full">
      <aside className="flex w-full flex-col border-l bg-[var(--surface)] lg:max-w-sm">
        <div className="shrink-0 space-y-2 border-b px-3 py-3">
          <Skeleton className="h-10 w-full rounded-lg" />
          <div className="flex flex-wrap gap-1.5">
            <Skeleton className="h-9 w-14 rounded-full" />
            <Skeleton className="h-9 w-12 rounded-full" />
            <Skeleton className="h-9 w-20 rounded-full" />
            <Skeleton className="h-9 w-24 rounded-full" />
          </div>
          <Skeleton className="h-3 w-16" />
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {Array.from({ length: 8 }, (_, index) => (
            <div
              key={index}
              className="space-y-2 border-b px-4 py-3"
              aria-hidden="true"
            >
              <div className="flex items-center justify-between gap-3">
                <Skeleton
                  className={`h-4 ${
                    index % 3 === 0
                      ? "w-36"
                      : index % 3 === 1
                        ? "w-28"
                        : "w-44"
                  }`}
                />
                <Skeleton className="h-3 w-10 shrink-0" />
              </div>
              <div className="flex items-center justify-between gap-3">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </aside>

      <section className="hidden min-w-0 flex-1 items-center justify-center bg-[var(--background)] lg:flex">
        <div className="flex flex-col items-center gap-3">
          <Skeleton className="size-10 rounded-full" />
          <Skeleton className="h-4 w-40" />
        </div>
      </section>
    </LoadingFrame>
  );
}

export function ReportsSkeleton() {
  return (
    <LoadingFrame className="dashboard-page max-w-4xl">
      <DashboardHeaderSkeleton />

      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => (
          <div
            key={index}
            className="space-y-3 rounded-xl border bg-[var(--surface)] p-3"
          >
            <Skeleton className="h-3 w-20 max-w-full" />
            <Skeleton className="h-7 w-10" />
          </div>
        ))}
      </div>

      <div className="mb-6 grid gap-2 sm:grid-cols-2">
        {Array.from({ length: 2 }, (_, index) => (
          <div
            key={index}
            className="space-y-3 rounded-xl border bg-[var(--surface)] p-3"
          >
            <Skeleton className="h-3 w-44 max-w-full" />
            <Skeleton className="h-7 w-16" />
            {index === 1 ? <Skeleton className="h-3 w-64 max-w-full" /> : null}
          </div>
        ))}
      </div>

      <Skeleton className="mb-3 h-4 w-28" />
      <div className="space-y-2">
        {Array.from({ length: 3 }, (_, index) => (
          <div
            key={index}
            className="flex items-center gap-3 rounded-2xl border bg-[var(--surface)] p-4"
          >
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-48 max-w-full" />
            </div>
            <Skeleton className="size-5 shrink-0" />
          </div>
        ))}
      </div>
    </LoadingFrame>
  );
}

export function OrdersSkeleton() {
  return (
    <LoadingFrame className="dashboard-page max-w-4xl">
      <DashboardHeaderSkeleton />

      <div className="mb-5 grid grid-cols-3 gap-2 sm:grid-cols-4">
        {Array.from({ length: 3 }, (_, index) => (
          <div
            key={index}
            className="space-y-3 rounded-xl border bg-[var(--surface)] p-3"
          >
            <Skeleton className="h-3 w-16 max-w-full" />
            <Skeleton className="h-7 w-10" />
          </div>
        ))}
      </div>

      <div className="mb-4 space-y-2">
        <Skeleton className="h-11 w-full rounded-xl" />
        <div className="flex flex-wrap gap-1.5">
          <Skeleton className="h-9 w-14 rounded-full" />
          <Skeleton className="h-9 w-16 rounded-full" />
          <Skeleton className="h-9 w-20 rounded-full" />
          <Skeleton className="h-9 w-16 rounded-full" />
        </div>
      </div>

      <Skeleton className="mb-2 h-3 w-28" />
      <div className="space-y-2">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className="space-y-3 rounded-2xl border bg-[var(--surface)] p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-28" />
              </div>
              <Skeleton className="h-5 w-20 shrink-0 rounded-full" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-3.5 w-52 max-w-full" />
              <Skeleton className="h-3.5 w-44 max-w-full" />
              <Skeleton className="h-3.5 w-32 max-w-full" />
            </div>
            <div className="flex items-center justify-between gap-3 border-t pt-3">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-9 w-28 shrink-0 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    </LoadingFrame>
  );
}

export function TeamSkeleton() {
  return (
    <LoadingFrame className="dashboard-page max-w-3xl">
      <DashboardHeaderSkeleton />

      <div className="mb-6 space-y-4 rounded-2xl border bg-[var(--surface)] p-4 sm:p-5">
        <Skeleton className="h-5 w-32" />
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="space-y-2">
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="h-11 w-full rounded-lg" />
            </div>
          ))}
        </div>
        <Skeleton className="h-11 w-32 rounded-lg" />
      </div>

      <div className="space-y-2">
        {Array.from({ length: 3 }, (_, index) => (
          <div
            key={index}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-[var(--surface)] p-3"
          >
            <div className="space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-52 max-w-full" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-10 w-24 rounded-lg" />
              <Skeleton className="h-10 w-16 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    </LoadingFrame>
  );
}

export function SettingsSkeleton() {
  return (
    <LoadingFrame className="mx-auto max-w-lg px-4 py-6" >
      <div className="mb-5 flex items-center gap-2">
        <Skeleton className="size-5 rounded-full" />
        <Skeleton className="h-5 w-32" />
      </div>

      <div className="mb-5 space-y-2">
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-4/5" />
      </div>

      <div className="space-y-4 rounded-2xl border bg-[var(--surface)] p-4">
        {Array.from({ length: 2 }, (_, index) => (
          <div key={index} className="space-y-2">
            <Skeleton className="h-4 w-56 max-w-full" />
            <Skeleton className="h-11 w-full rounded-lg" />
          </div>
        ))}
        <Skeleton className="h-11 w-full rounded-xl" />
      </div>
    </LoadingFrame>
  );
}

export function ConnectSkeleton() {
  return (
    <LoadingFrame className="dashboard-page max-w-2xl">
      <DashboardHeaderSkeleton />

      <div className="flex flex-col items-center gap-4 rounded-2xl border bg-[var(--surface)] p-6">
        <Skeleton className="size-64 max-w-full rounded-xl" />
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-10 w-28 rounded-lg" />
        <div className="w-full max-w-sm space-y-2">
          <Skeleton className="h-3.5 w-4/5" />
          <Skeleton className="h-3.5 w-3/4" />
          <Skeleton className="h-3.5 w-2/3" />
        </div>
      </div>
    </LoadingFrame>
  );
}

export function DashboardSkeleton() {
  return (
    <LoadingFrame className="dashboard-page max-w-4xl">
      <DashboardHeaderSkeleton />
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className="space-y-3 rounded-2xl border bg-[var(--surface)] p-5"
          >
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-3/4" />
          </div>
        ))}
      </div>
    </LoadingFrame>
  );
}
