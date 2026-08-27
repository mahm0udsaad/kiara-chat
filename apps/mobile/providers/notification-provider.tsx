import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type PropsWithChildren,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  registerFieldNotifications,
  registerInboxNotifications,
  type NotificationRegistration,
} from "@/lib/notifications";
import { queryKeys, useBootstrap } from "@/lib/queries";
import { useAuth } from "@/providers/auth-provider";

/** Alert kinds the server sends for the inbox — see `lib/inbox-notifications`. */
const INBOX_ALERTS = new Set(["inbox_message", "inbox_unassigned", "inbox_danger"]);
const FIELD_ALERTS = new Set(["field_order", "field_push_test"]);

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

type NotificationStatus = {
  registration: NotificationRegistration | null;
  /** Re-run registration — the account screen's retry after fixing settings. */
  refresh: () => Promise<void>;
};

const NotificationStatusContext = createContext<NotificationStatus>({
  registration: null,
  refresh: async () => {},
});

/** Whether this device is actually reachable by push, and why not if it isn't. */
export function useNotificationStatus(): NotificationStatus {
  return use(NotificationStatusContext);
}

export function NotificationProvider({ children }: PropsWithChildren) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const bootstrap = useBootstrap(Boolean(session));
  const role = bootstrap.data?.session.role;
  const fieldStaff = role === "specialist" || role === "driver";
  const inboxStaff = role === "admin" || role === "agent";
  const teamMemberId = bootstrap.data?.session.teamMemberId;
  const [registration, setRegistration] = useState<NotificationRegistration | null>(
    null,
  );
  // Bumped by the account screen's retry, after the employee has gone into the
  // system settings and turned notifications back on.
  const [attempt, setAttempt] = useState(0);
  const register = fieldStaff
    ? registerFieldNotifications
    : inboxStaff && teamMemberId
      ? registerInboxNotifications
      : null;

  useEffect(() => {
    if (!register) return;

    let cancelled = false;
    void register()
      .catch(
        (error: unknown): NotificationRegistration => ({
          state: "failed",
          message: error instanceof Error ? error.message : "تعذّر تفعيل الإشعارات",
        }),
      )
      .then((result) => {
        if (!cancelled) setRegistration(result);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, register]);

  // APNs/FCM can rotate the native token while the app is running. Recreate
  // and upload the derived Expo token immediately instead of waiting for the
  // employee to restart or sign in again.
  useEffect(() => {
    if (!register) return;
    const subscription = Notifications.addPushTokenListener(() => {
      void register().then(setRegistration).catch((error: unknown) => {
        setRegistration({
          state: "failed",
          message: error instanceof Error ? error.message : "تعذّر تحديث رمز الإشعارات",
        });
      });
    });
    return () => subscription.remove();
  }, [register]);

  const refresh = useCallback(async () => {
    setAttempt((previous) => previous + 1);
  }, []);

  const status = useMemo(
    () => ({ registration, refresh }),
    [registration, refresh],
  );

  useEffect(() => {
    const subscription = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data;
      if (typeof data?.type !== "string") return;
      if (FIELD_ALERTS.has(data.type)) {
        void queryClient.invalidateQueries({ queryKey: ["field-orders"] });
        if (typeof data.orderId === "string") {
          void queryClient.invalidateQueries({
            queryKey: queryKeys.fieldOrder(data.orderId),
          });
        }
        return;
      }
      if (!INBOX_ALERTS.has(data.type)) return;
      // Every inbox alert changes at least one list count (new, unassigned,
      // danger), so the tab badges are refreshed even when the alert is about
      // a thread this employee has not opened.
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
      if (typeof data.conversationId === "string") {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.conversation(data.conversationId),
        });
      }
    });
    return () => subscription.remove();
  }, [queryClient]);

  const openNotification = useCallback(
    (response: Notifications.NotificationResponse) => {
      const url = response.notification.request.content.data?.url;
      if (typeof url === "string" && url.startsWith("/field/orders/")) {
        router.push(url as never);
      } else if (url === "/field/account") {
        router.push("/field/account");
      } else if (typeof url === "string" && url.startsWith("/inbox/")) {
        router.push(url as never);
      }
    },
    [router],
  );

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(openNotification);
    return () => subscription.remove();
  }, [openNotification]);

  // The listener above only catches taps while the JS runtime exists. Handle
  // the notification that launched a killed app once, then clear it so a later
  // cold start does not reopen the same order.
  useEffect(() => {
    let active = true;
    void Notifications.getLastNotificationResponseAsync()
      .then(async (response) => {
        if (!active || !response) return;
        openNotification(response);
        await Notifications.clearLastNotificationResponseAsync();
      })
      // A cold start must not be brought down by the notification that opened
      // it: failing to read or clear the response is worth a log, never a crash.
      .catch((error: unknown) => {
        console.warn("[notifications] cold-start response failed", error);
      });
    return () => {
      active = false;
    };
  }, [openNotification]);

  return (
    <NotificationStatusContext value={status}>{children}</NotificationStatusContext>
  );
}
