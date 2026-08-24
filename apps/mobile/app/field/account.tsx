import { useQueryClient } from "@tanstack/react-query";
import { Alert, ScrollView, Text, View } from "react-native";

import { PrimaryButton } from "@/components/primary-button";
import { LegalLinks } from "@/components/legal-links";
import { ErrorState, LoadingScreen } from "@/components/screen-state";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/detail-row";
import { rtlText, spacing, type } from "@/constants/theme";
import {
  notificationStateLabel,
  unregisterFieldNotifications,
} from "@/lib/notifications";
import { useBootstrap, useFieldPushTest } from "@/lib/queries";
import { useAuth } from "@/providers/auth-provider";
import { useNotificationStatus } from "@/providers/notification-provider";
import { useTheme } from "@/providers/theme-provider";

export default function FieldAccountScreen() {
  const { colors } = useTheme();
  const { signOut } = useAuth();
  const queryClient = useQueryClient();
  const bootstrap = useBootstrap();
  const notification = useNotificationStatus();
  const pushTest = useFieldPushTest();
  const notificationsOn = notification.registration?.state === "registered";
  if (bootstrap.isLoading) return <LoadingScreen />;
  if (!bootstrap.data) return <ErrorState title="تعذر تحميل الحساب" message={bootstrap.error?.message ?? "تعذر تحميل الحساب"} onRetry={() => void bootstrap.refetch()} />;
  const session = bootstrap.data.session;
  const roleLabel = session.role === "specialist" ? "أخصائية" : "سائق";
  const testPush = () => {
    pushTest.mutate(undefined, {
      onSuccess: ({ delivery }) => {
        if (delivery.delivered > 0) {
          Alert.alert("الإشعارات تعمل", "تم تسليم إشعار الاختبار إلى هذا الجهاز.");
          return;
        }
        if (delivery.accepted > 0 || delivery.pending > 0) {
          Alert.alert(
            "تم إرسال الاختبار",
            "قبلت خدمة الإشعارات الطلب، لكن إيصال التسليم لم يظهر بعد. انتظري قليلًا.",
          );
          return;
        }
        Alert.alert(
          "لم يصل الاختبار",
          delivery.attempted === 0
            ? "لا يوجد رمز إشعارات مسجل لهذا الجهاز. أعيدي تفعيل الإشعارات أولًا."
            : `رفضت خدمة الإشعارات الطلب: ${delivery.errors.join("، ") || "خطأ غير معروف"}`,
        );
      },
      onError: (error) => Alert.alert("تعذر اختبار الإشعارات", error.message),
    });
  };
  const logout = () => {
    Alert.alert("تسجيل الخروج", "سيتم إغلاق الجلسة على هذا الجهاز.", [
      { text: "رجوع", style: "cancel" },
      {
        text: "تسجيل الخروج",
        style: "destructive",
        onPress: async () => {
          await unregisterFieldNotifications().catch(() => undefined);
          queryClient.clear();
          await signOut();
        },
      },
    ]);
  };
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl }}>
      <Card>
        <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.md }}>
          <Avatar name={session.displayName} seed={session.userId} size={58} />
          <View style={{ flex: 1, alignItems: "flex-end", gap: spacing.sm }}>
            <Text style={{ ...type.title3, color: colors.text, ...rtlText }}>{session.displayName}</Text>
            <Badge label={roleLabel} tone="brand" icon={session.role === "specialist" ? "sparkles" : "car"} />
          </View>
        </View>
      </Card>
      <View style={{ gap: spacing.sm }}>
        <SectionHeader title="الإشعارات" />
        <Card>
          <Badge
            label={notificationsOn ? "مفعّلة" : "غير مفعّلة"}
            tone={notificationsOn ? "success" : "warning"}
            icon={notificationsOn ? "checkmark.circle" : "exclamationmark.triangle"}
          />
          <Text selectable style={{ ...type.footnote, color: colors.textSecondary, ...rtlText }}>
            {notification.registration
              ? notification.registration.state === "failed"
                ? notification.registration.message
                : notificationStateLabel[notification.registration.state]
              : "جارٍ التحقق من حالة الإشعارات…"}
          </Text>
          {notificationsOn ? (
            <PrimaryButton
              label="إرسال إشعار اختبار"
              icon="bell"
              variant="tinted"
              loading={pushTest.isPending}
              onPress={testPush}
            />
          ) : (
            <PrimaryButton
              label="تفعيل الإشعارات"
              icon="bell"
              variant="tinted"
              onPress={() => void notification.refresh()}
            />
          )}
        </Card>
      </View>
      <View style={{ gap: spacing.sm }}>
        <SectionHeader title="القانونية والدعم" />
        <LegalLinks />
      </View>
      <PrimaryButton label="تسجيل الخروج" icon="rectangle.portrait.and.arrow.right" tone="danger" variant="tinted" onPress={logout} />
    </ScrollView>
  );
}
