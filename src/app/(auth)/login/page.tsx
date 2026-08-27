"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/** Long enough for a slow sign-in, short enough to report a dead service. */
const SIGN_IN_TIMEOUT_MS = 20_000;

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

    let result: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>;
    try {
      result = await Promise.race([
        supabase.auth.signInWithPassword({ email, password }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), SIGN_IN_TIMEOUT_MS),
        ),
      ]);
    } catch {
      // Auth can accept the connection and then never answer — the project
      // wedges and every request that needs the database simply stops coming
      // back. Without a deadline the button just stayed on "جارٍ الدخول…"
      // forever, which is indistinguishable from a wrong password, so nobody
      // could tell a bad credential from a service that was down.
      setError("تعذر الوصول إلى الخادم. حاولي المحاولة بعد قليل.");
      setLoading(false);
      return;
    }

    if (result.error) {
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
        <p className="mt-1 text-sm text-muted-foreground">تسجيل دخول الموظفين</p>
      </div>
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm text-muted-foreground">
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
          <label className="mb-1 block text-sm text-muted-foreground">
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
