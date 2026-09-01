import { redirect } from "next/navigation";
import { getKiaraSession } from "@/lib/tenant";
import { SignOutButton } from "@/components/sign-out-button";
import { AppNav } from "@/components/app-nav";
import { ViewportHeight } from "@/components/viewport-height";
import { AppPresenceHeartbeat } from "@/components/app-presence-heartbeat";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getKiaraSession();
  if (!session) redirect("/login");

  return (
    // .app-shell is fixed to the *visible* viewport (see globals.css), so the
    // composer stays above the on-screen keyboard instead of behind it. The
    // header keeps its size and <main> takes the rest.
    <div className="app-shell">
      <AppPresenceHeartbeat />
      <header className="safe-t shrink-0 border-b bg-[var(--surface)]">
        <div className="flex items-center justify-between gap-3 px-3 py-2 sm:px-5 sm:py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span
              translate="no"
              className="truncate text-base font-bold text-[var(--brand)] sm:text-lg"
            >
              Kiara Chat
            </span>
            <span className="shrink-0 rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-[11px] text-[var(--brand)]">
              {session.role === "admin" ? "مدير" : "موظف"}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
            {/* The email is the first thing to drop when space is tight. */}
            <span dir="ltr" className="hidden max-w-[220px] truncate md:block">
              {session.email}
            </span>
            <SignOutButton />
          </div>
        </div>
        <AppNav isAdmin={session.role === "admin"} isOwner={session.isOwner} />
      </header>
      <main className="scroll-pane min-h-0 flex-1">{children}</main>
      <ViewportHeight />
    </div>
  );
}
