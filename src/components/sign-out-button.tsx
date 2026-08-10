"use client";

import { useTransition } from "react";
import { signOut } from "@/app/actions/auth";
import { clearDispatchOptionsCache } from "@/lib/dispatch-options-client";

export function SignOutButton() {
  const [pending, startTransition] = useTransition();

  function handleSignOut() {
    clearDispatchOptionsCache();
    startTransition(() => {
      void signOut();
    });
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={pending}
      className="rounded-md border px-3 py-1 transition hover:bg-[var(--brand-soft)] disabled:opacity-60"
    >
      {pending ? "جارٍ الخروج…" : "خروج"}
    </button>
  );
}
