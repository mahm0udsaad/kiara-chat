import { redirect } from "next/navigation";
import { getKiaraSession } from "@/lib/tenant";
import { SignOutButton } from "@/components/sign-out-button";
import { AppNav } from "@/components/app-nav";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getKiaraSession();
  if (!session) redirect("/login");

  return (
    // Fixed-height flex column: the header keeps its size and <main> takes the
    // rest, so the inbox can fill the screen without hardcoding a header
    // offset. dvh (not vh) so mobile browser chrome can't clip the composer.
    <div className="flex h-[100dvh] flex-col">
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
          <div className="flex shrink-0 items-center gap-2 text-sm text-[var(--muted)]">
            {/* The email is the first thing to drop when space is tight. */}
            <span dir="ltr" className="hidden max-w-[220px] truncate md:block">
              {session.email}
            </span>
            <SignOutButton />
          </div>
        </div>
        <AppNav isAdmin={session.role === "admin"} />
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
