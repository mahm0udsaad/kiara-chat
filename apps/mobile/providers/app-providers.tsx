import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type PropsWithChildren, useEffect, useState } from "react";
import { AppState } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { supabase } from "@/lib/supabase";
import { AuthProvider } from "@/providers/auth-provider";
import { ThemeProvider } from "@/providers/theme-provider";
import { NotificationProvider } from "@/providers/notification-provider";
import { InboxLiveProvider } from "@/providers/inbox-live-provider";

// iOS reports the app active slightly before its network path is consistently
// usable. This grace period also lets Supabase start its refresh tick before
// TanStack Query refetches every stale screen at once.
const FOREGROUND_SETTLE_MS = 750;

export function AppProviders({ children }: PropsWithChildren) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: (failureCount, error) => {
              const status =
                typeof error === "object" && error && "status" in error
                  ? Number(error.status)
                  : 0;
              return status !== 401 && status !== 403 && failureCount < 2;
            },
          },
          mutations: { retry: false },
        },
      }),
  );

  useEffect(() => {
    if (process.env.EXPO_OS === "web") return;

    let focusTimer: ReturnType<typeof setTimeout> | null = null;
    let appStateRevision = 0;
    const clearFocusTimer = () => {
      if (focusTimer) clearTimeout(focusTimer);
      focusTimer = null;
    };
    const releaseQueryFocus = (revision: number) => {
      if (revision !== appStateRevision || AppState.currentState !== "active") return;
      clearFocusTimer();
      focusTimer = setTimeout(() => {
        focusTimer = null;
        if (revision === appStateRevision && AppState.currentState === "active") {
          focusManager.setFocused(true);
        }
      }, FOREGROUND_SETTLE_MS);
    };
    const syncAppState = (state: string) => {
      const revision = ++appStateRevision;
      clearFocusTimer();
      if (state !== "active") {
        focusManager.setFocused(false);
        void supabase.auth.stopAutoRefresh();
        return;
      }

      // Keep queries paused until Auth has re-armed its foreground refresh.
      // startAutoRefresh schedules its tick; either resolution path can safely
      // release Query's focus because the Auth fetch itself has a hard deadline.
      focusManager.setFocused(false);
      void supabase.auth
        .startAutoRefresh()
        .then(
          () => releaseQueryFocus(revision),
          () => releaseQueryFocus(revision),
        );
    };

    syncAppState(AppState.currentState);
    const subscription = AppState.addEventListener("change", syncAppState);
    return () => {
      clearFocusTimer();
      subscription.remove();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AuthProvider>
            <InboxLiveProvider>
              <NotificationProvider>{children}</NotificationProvider>
            </InboxLiveProvider>
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
