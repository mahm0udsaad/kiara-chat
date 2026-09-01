import Constants, { ExecutionEnvironment } from "expo-constants";
import type * as NotificationsModule from "expo-notifications";
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
  isInboxMuted,
  registerFieldNotifications,
  registerInboxNotifications,
  setInboxMuted,
  unregisterInboxNotifications,
  type NotificationRegistration,
} from "@/lib/notifications";
import { queryKeys, useBootstrap } from "@/lib/queries";
import { useAuth } from "@/providers/auth-provider";

/** Alert kinds the server sends for the inbox — see `lib/inbox-notifications`. */
const INBOX_ALERTS = new Set(["inbox_message", "inbox_unassigned", "inbox_danger"]);
const FIELD_ALERTS = new Set(["field_order", "field_push_test"]);

/**
 * Expo Go on SDK 53+ throws the moment `expo-notifications` is even
 * imported on Android (and blocks remote push on iOS too), so this module
 * must never be reached in Expo Go — the listeners below all become no-ops
 * there instead.
 */
function isExpoGo(): boolean {
  return (
    Constants.executionEnvironment === ExecutionEnvironment.StoreClient ||
    Constants.appOwnership === "expo"
  );
}

let notificationsPromise: Promise<typeof NotificationsModule> | null = null;
function loadNotifications(): Promise<typeof NotificationsModule> | null {
  if (isExpoGo()) return null;
  if (!notificationsPromise) {
    notificationsPromise = import("expo-notifications").then((mod) => {
      mod.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
        }),
      });
      return mod;
    });
  }
  return notificationsPromise;
}

type NotificationStatus = {
  registration: NotificationRegistration | null;
  /** Re-run registration — the account screen's retry after fixing settings.
   *  Also clears a mute, so one button can mean "turn these back on". */
  refresh: () => Promise<void>;
  /** Stop alerts on this device and remember that it was deliberate. */
  disable: () => Promise<void>;
};

const NotificationStatusContext = createContext<NotificationStatus>({
  registration: null,
  refresh: async () => {},
  disable: async () => {},
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
  // null while the stored preference is still being read — registering before
  // it lands would re-arm a device the employee had switched off.
  const [muted, setMuted] = useState<boolean | null>(null);
  // null in Expo Go, where the module must never load; the listener effects
  // below all short-circuit on that.
  const [Notifications, setNotifications] = useState<typeof NotificationsModule | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    const promise = loadNotifications();
    if (!promise) return;
    void promise.then((mod) => {
      if (!cancelled) setNotifications(mod);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void isInboxMuted()
      .catch(() => false)
      .then((value) => {
        if (!cancelled) setMuted(value);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const accountId = session?.user.id ?? null;
  const register = useMemo(() => {
    if (!accountId) return null;
    if (fieldStaff) return () => registerFieldNotifications(accountId);
    if (inboxStaff && teamMemberId) {
      return () => registerInboxNotifications(accountId);
    }
    return null;
  }, [accountId, fieldStaff, inboxStaff, teamMemberId]);

  useEffect(() => {
    // Only the inbox registration answers to the switch: field staff register
    // through a different screen that does not offer one, and must not be left
    // waiting on a preference that will never apply to them.
    if (inboxStaff && muted !== false) return;
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
  }, [attempt, register, muted, inboxStaff]);

  // APNs/FCM can rotate the native token while the app is running. Recreate
  // and upload the derived Expo token immediately instead of waiting for the
  // employee to restart or sign in again.
  useEffect(() => {
    if (!Notifications || !register || (inboxStaff && muted !== false)) return;
    let lastSeen: string | null = null;
    const subscription = Notifications.addPushTokenListener((token) => {
      // Acquiring a token can itself emit this event, so re-registering on every
      // emission feeds itself: register → getExpoPushTokenAsync → event →
      // register → … Each turn of that loop is another upload, which is how a
      // single rotation became a burst of identical POSTs. Only a token that
      // genuinely differs from the last one seen is worth acting on.
      const next =
        typeof token.data === "string" ? token.data : JSON.stringify(token.data);
      if (next === lastSeen) return;
      lastSeen = next;
      void register().then(setRegistration).catch((error: unknown) => {
        setRegistration({
          state: "failed",
          message: error instanceof Error ? error.message : "تعذّر تحديث رمز الإشعارات",
        });
      });
    });
    return () => subscription.remove();
  }, [Notifications, register, muted, inboxStaff]);

  const refresh = useCallback(async () => {
    await setInboxMuted(false).catch(() => undefined);
    setMuted(false);
    setAttempt((previous) => previous + 1);
  }, []);

  const disable = useCallback(async () => {
    // Remember the choice first: if the unregister call fails on a bad
    // connection the device still stops re-arming itself on next launch, and
    // the server drops the token the next time Expo rejects it.
    await setInboxMuted(true).catch(() => undefined);
    setMuted(true);
    await unregisterInboxNotifications().catch(() => undefined);
  }, []);

  // Derived, not stored: a muted device may still hold the "registered" result
  // of the attempt that ran before the employee switched it off.
  const exposed = useMemo<NotificationRegistration | null>(
    () => (inboxStaff && muted ? { state: "muted" } : registration),
    [inboxStaff, muted, registration],
  );

  const status = useMemo(
    () => ({ registration: exposed, refresh, disable }),
    [exposed, refresh, disable],
  );

  useEffect(() => {
    if (!Notifications) return;
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
        void queryClient.invalidateQueries({
          queryKey: queryKeys.conversationMessages(data.conversationId),
        });
      }
    });
    return () => subscription.remove();
  }, [Notifications, queryClient]);

  const openNotification = useCallback(
    (response: NotificationsModule.NotificationResponse) => {
      const url = response.notification.request.content.data?.url;
      if (typeof url === "string" && url.startsWith("/field/orders/")) {
        router.push(url as never);
      } else if (url === "/field/account") {
        router.push("/field/account");
      } else if (typeof url === "string" && url.startsWith("/inbox/")) {
        // The server still addresses a thread as `/inbox/<id>`, and so do
        // notifications already sitting on older installs. The screen moved
        // out of the tabs group, so translate rather than break those.
        const conversationId = url.slice("/inbox/".length);
        if (conversationId) {
          router.push({
            pathname: "/conversation/[id]",
            params: { id: conversationId },
          });
        }
      }
    },
    [router],
  );

  useEffect(() => {
    if (!Notifications) return;
    const subscription = Notifications.addNotificationResponseReceivedListener(openNotification);
    return () => subscription.remove();
  }, [Notifications, openNotification]);

  // The listener above only catches taps while the JS runtime exists. Handle
  // the notification that launched a killed app once, then clear it so a later
  // cold start does not reopen the same order.
  useEffect(() => {
    if (!Notifications) return;
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
  }, [Notifications, openNotification]);

  return (
    <NotificationStatusContext value={status}>{children}</NotificationStatusContext>
  );
}
