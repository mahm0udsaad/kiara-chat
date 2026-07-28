/**
 * Streamed shell for every (app) route.
 *
 * Without this the router has no Suspense boundary to fall back to, so a
 * navigation blocks on the page's server render — auth + data — and the browser
 * keeps showing the *previous* page the whole time. The skeleton mirrors the
 * inbox two-pane layout because that's the route users hit most.
 */
function Bar({ className = "" }: { className?: string }) {
  return <div className={`rounded bg-[var(--line)] ${className}`} />;
}

export default function AppLoading() {
  return (
    <div className="flex h-full animate-pulse" aria-busy="true" aria-live="polite">
      <span className="sr-only">جارٍ التحميل…</span>

      {/* Conversation list — full width on phones, sidebar from lg. */}
      <aside className="flex w-full flex-col border-l bg-[var(--surface)] lg:max-w-sm">
        <div className="shrink-0 space-y-2 border-b px-3 py-3">
          <Bar className="h-10 w-full" />
          <div className="flex flex-wrap gap-1.5">
            <Bar className="h-9 w-14 rounded-full" />
            <Bar className="h-9 w-12 rounded-full" />
            <Bar className="h-9 w-20 rounded-full" />
            <Bar className="h-9 w-24 rounded-full" />
          </div>
        </div>
        <div className="min-h-0 flex-1 space-y-px overflow-hidden">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex items-start gap-3 border-b px-3 py-3">
              <Bar className="size-10 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Bar className="h-3.5 w-32" />
                  <Bar className="h-3 w-10 shrink-0" />
                </div>
                <Bar className="h-3 w-full max-w-[15rem]" />
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* Thread pane — only rendered from lg, matching the real layout. */}
      <section className="hidden min-w-0 flex-1 flex-col lg:flex">
        <div className="shrink-0 border-b px-4 py-3">
          <Bar className="h-4 w-40" />
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-hidden p-4">
          {[
            "me", "them", "them", "me", "them",
          ].map((side, i) => (
            <div
              key={i}
              className={side === "me" ? "flex justify-start" : "flex justify-end"}
            >
              <Bar
                className={`h-12 rounded-2xl ${i % 3 === 0 ? "w-56" : i % 3 === 1 ? "w-40" : "w-64"}`}
              />
            </div>
          ))}
        </div>
        <div className="shrink-0 border-t p-3">
          <Bar className="h-11 w-full rounded-xl" />
        </div>
      </section>
    </div>
  );
}
