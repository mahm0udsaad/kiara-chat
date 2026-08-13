import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { type PropsWithChildren, useEffect } from "react";

import {
  registerFieldNotifications,
  registerInboxNotifications,
} from "@/lib/notifications";
import { queryKeys, useBootstrap } from "@/lib/queries";
import { useAuth } from "@/providers/auth-provider";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export function NotificationProvider({ children }: PropsWithChildren) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const bootstrap = useBootstrap(Boolean(session));
  const role = bootstrap.data?.session.role;
  const fieldStaff = role === "specialist" || role === "driver";
  const inboxStaff = role === "admin" || role === "agent";

  useEffect(() => {
    if (!fieldStaff) return;
    void registerFieldNotifications().catch(() => undefined);
  }, [fieldStaff]);

  useEffect(() => {
    if (!inboxStaff || !bootstrap.data?.session.teamMemberId) return;
    void registerInboxNotifications().catch(() => undefined);
  }, [bootstrap.data?.session.teamMemberId, inboxStaff]);

  useEffect(() => {
    const subscription = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data;
      if (data?.type !== "inbox_message" || typeof data.conversationId !== "string") return;
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["conversations"] }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.conversation(data.conversationId),
        }),
      ]);
    });
    return () => subscription.remove();
  }, [queryClient]);

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const url = response.notification.request.content.data?.url;
      if (typeof url === "string" && url.startsWith("/field/orders/")) {
        router.push(url as never);
      } else if (typeof url === "string" && url.startsWith("/inbox/")) {
        router.push(url as never);
      }
    });
    return () => subscription.remove();
  }, [router]);

  return children;
}
