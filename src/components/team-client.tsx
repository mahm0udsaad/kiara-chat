"use client";

import { useCallback, useState } from "react";
import { Loader2, UserPlus, KeyRound, Ban, RotateCcw, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TeamMemberRow } from "@/lib/team";

function roleLabel(role: string) {
  return role === "admin" ? "مدير" : "موظف";
}

export function TeamClient({ initialTeam }: { initialTeam: TeamMemberRow[] }) {
  const [team, setTeam] = useState(initialTeam);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"agent" | "admin">("agent");
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/team");
    if (res.ok) setTeam((await res.json()).team ?? []);
  }, []);

  const createMember = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setNotice(null);
      setCreating(true);
      try {
        const res = await fetch("/api/team", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fullName, email, password, role }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data?.error ?? "تعذّر إنشاء الحساب");
          return;
        }
        setNotice(`تم إنشاء حساب ${fullName}. سلّمي بيانات الدخول للموظف.`);
        setFullName("");
        setEmail("");
        setPassword("");
        setRole("agent");
        await refresh();
      } finally {
        setCreating(false);
      }
    },
    [fullName, email, password, role, refresh]
  );

  const toggleActive = useCallback(
    async (m: TeamMemberRow) => {
      setBusyId(m.id);
      setError(null);
      setNotice(null);
      try {
        const res = await fetch(`/api/team/${m.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: !m.isActive }),
        });
        if (!res.ok) {
          setError((await res.json())?.error ?? "تعذّر التحديث");
          return;
        }
        await refresh();
      } finally {
        setBusyId(null);
      }
    },
    [refresh]
  );

  const resetPassword = useCallback(
    async (m: TeamMemberRow) => {
      const next = window.prompt(`كلمة مرور جديدة لـ ${m.fullName || m.email}:`);
      if (!next) return;
      setBusyId(m.id);
      setError(null);
      setNotice(null);
      try {
        const res = await fetch(`/api/team/${m.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: next, userId: m.userId }),
        });
        if (!res.ok) {
          setError((await res.json())?.error ?? "تعذّر تغيير كلمة المرور");
          return;
        }
        setNotice("تم تغيير كلمة المرور.");
      } finally {
        setBusyId(null);
      }
    },
    []
  );

  return (
    <div className="dashboard-page max-w-3xl">
      <div className="dashboard-page-header">
        <div>
          <h1>الموظفون</h1>
          <p>أنشئي حسابات لموظفي الصالون. لا يمكن لأحد التسجيل بنفسه.</p>
        </div>
      </div>

      <form
        onSubmit={createMember}
        className="mb-6 space-y-3 rounded-2xl border bg-[var(--surface)] p-4 sm:p-5"
      >
        <h2 className="flex items-center gap-2 font-semibold">
          <UserPlus size={18} aria-hidden="true" /> إضافة موظف
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm text-[var(--muted)]">الاسم</span>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              name="fullName"
              autoComplete="off"
              placeholder="مثال: وفاء…"
              className="min-h-11 w-full rounded-lg border px-3 outline-none focus:border-[var(--brand)]"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-[var(--muted)]">البريد الإلكتروني</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              type="email"
              name="email"
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              placeholder="wafaa@kiara.com"
              className="min-h-11 w-full rounded-lg border px-3 outline-none focus:border-[var(--brand)]"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-[var(--muted)]">كلمة المرور</span>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              type="text"
              name="new-password"
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              placeholder="6 أحرف على الأقل…"
              className="min-h-11 w-full rounded-lg border px-3 outline-none focus:border-[var(--brand)]"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-[var(--muted)]">الصلاحية</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "agent" | "admin")}
              className="min-h-11 w-full rounded-lg border px-3"
            >
              <option value="agent">موظف</option>
              <option value="admin">مدير</option>
            </select>
          </label>
        </div>

        {error ? (
          <p aria-live="polite" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p
            aria-live="polite"
            className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
          >
            <Check size={14} aria-hidden="true" /> {notice}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={creating}
          className="flex min-h-11 items-center gap-2 rounded-lg bg-[var(--brand)] px-4 text-sm font-medium text-white disabled:opacity-60"
        >
          {creating ? (
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
          ) : (
            <UserPlus size={16} aria-hidden="true" />
          )}
          إنشاء الحساب
        </button>
      </form>

      <ul className="space-y-2">
        {team.map((m) => (
          <li
            key={m.id}
            className={cn(
              "flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-[var(--surface)] p-3",
              !m.isActive && "opacity-60"
            )}
          >
            <div className="min-w-0">
              <p className="truncate font-medium">
                {m.fullName || m.email}{" "}
                <span className="rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-[11px] text-[var(--brand)]">
                  {roleLabel(m.role)}
                </span>
                {!m.isActive ? (
                  <span className="mr-1 rounded-full bg-slate-200 px-2 py-0.5 text-[11px] text-slate-600">
                    موقوف
                  </span>
                ) : null}
              </p>
              <p dir="ltr" className="truncate text-xs text-[var(--muted)]">
                {m.email}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => resetPassword(m)}
                disabled={busyId === m.id}
                className="flex min-h-10 items-center gap-1 rounded-lg border px-3 text-xs text-[var(--muted)] hover:bg-[var(--brand-soft)] disabled:opacity-60"
              >
                <KeyRound size={14} aria-hidden="true" /> كلمة المرور
              </button>
              <button
                type="button"
                onClick={() => toggleActive(m)}
                disabled={busyId === m.id}
                className="flex min-h-10 items-center gap-1 rounded-lg border px-3 text-xs text-[var(--muted)] hover:bg-[var(--brand-soft)] disabled:opacity-60"
              >
                {busyId === m.id ? (
                  <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                ) : m.isActive ? (
                  <Ban size={14} aria-hidden="true" />
                ) : (
                  <RotateCcw size={14} aria-hidden="true" />
                )}
                {m.isActive ? "إيقاف" : "تفعيل"}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
