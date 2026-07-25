"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError("بيانات الدخول غير صحيحة.");
      setLoading(false);
      return;
    }
    router.push("/inbox");
    router.refresh();
  }

  return (
    <div className="w-full max-w-sm rounded-2xl border bg-[var(--surface)] p-8 shadow-sm">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-[var(--brand)]">Kiara Chat</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">تسجيل دخول الموظفين</p>
      </div>
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm text-[var(--muted)]">
            البريد الإلكتروني
          </label>
          <input
            type="email"
            required
            dir="ltr"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 outline-none focus:border-[var(--brand)]"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-[var(--muted)]">
            كلمة المرور
          </label>
          <input
            type="password"
            required
            dir="ltr"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 outline-none focus:border-[var(--brand)]"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-[var(--brand)] px-4 py-2 font-medium text-white transition hover:bg-[var(--brand-strong)] disabled:opacity-60"
        >
          {loading ? "جارٍ الدخول…" : "دخول"}
        </button>
      </form>
    </div>
  );
}
