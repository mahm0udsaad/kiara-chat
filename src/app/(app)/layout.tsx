import { redirect } from "next/navigation";
import { getKiaraSession } from "@/lib/tenant";
import { SignOutButton } from "@/components/sign-out-button";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getKiaraSession();
  if (!session) redirect("/login");

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b bg-[var(--surface)] px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-[var(--brand)]">Kiara Chat</span>
          <span className="rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-xs text-[var(--brand)]">
            {session.role === "admin" ? "مدير" : "موظف"}
          </span>
        </div>
        <div className="flex items-center gap-3 text-sm text-[var(--muted)]">
          <span dir="ltr">{session.email}</span>
          <SignOutButton />
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
