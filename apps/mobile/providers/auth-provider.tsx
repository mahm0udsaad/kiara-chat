import type { Session } from "@supabase/supabase-js";
import { createContext, type PropsWithChildren, use, useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";

type AuthContextValue = {
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * How long startup will wait for the stored session before showing *something*.
 * Generous enough that a merely slow keychain read still lands on the inbox,
 * short enough that a deadlocked one does not read as a hung app.
 */
const AUTH_INIT_TIMEOUT_MS = 8_000;

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let opened = false;

    /**
     * The launch gate must always open.
     *
     * `loading` blocks the whole app behind a full-screen spinner, and the only
     * thing that used to clear it was `getSession()` resolving. That call is not
     * as safe as it looks: supabase-js serialises session access behind a lock,
     * and the keychain-backed storage reads a sharded value one await at a time,
     * so a token refresh stalling on a flaky connection holds the lock and every
     * later read queues behind it. There was no `.catch()` either, so a rejection
     * was equally fatal. Either way the spinner stayed up with no error and no
     * retry — indistinguishable from a frozen app.
     *
     * So the gate opens on whichever comes first: the session, a failure, or the
     * deadline. Opening with no session lands on /login rather than the inbox,
     * which is wrong-but-recoverable; if the real session arrives late,
     * `onAuthStateChange` still delivers it and the app corrects itself.
     */
    const open = (next: Session | null) => {
      if (!active || opened) return;
      opened = true;
      setSession(next);
      setLoading(false);
    };

    const timer = setTimeout(() => open(null), AUTH_INIT_TIMEOUT_MS);

    void supabase.auth
      .getSession()
      .then(({ data }) => open(data.session))
      .catch(() => open(null));

    // Later auth events always win: this is how a sign-in, a sign-out, or a
    // session that resolved after the deadline reaches the tree.
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      opened = true;
      clearTimeout(timer);
      setSession(nextSession);
      setLoading(false);
    });

    return () => {
      active = false;
      clearTimeout(timer);
      data.subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider
      value={{
        session,
        loading,
        signOut: async () => {
          await supabase.auth.signOut();
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const value = use(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
