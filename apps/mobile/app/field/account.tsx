import { useQueryClient } from "@tanstack/react-query";
import { Alert, ScrollView, Text, View } from "react-native";

import { PrimaryButton } from "@/components/primary-button";
import { LegalLinks } from "@/components/legal-links";
import { ErrorState, LoadingScreen } from "@/components/screen-state";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DetailRow, SectionHeader } from "@/components/ui/detail-row";
import { spacing, type } from "@/constants/theme";
import { useFieldI18n } from "@/lib/field-i18n";
import { unregisterFieldNotifications } from "@/lib/notifications";
import { useBootstrap, useFieldPushTest } from "@/lib/queries";
import { useAuth } from "@/providers/auth-provider";
import { useNotificationStatus } from "@/providers/notification-provider";
import { useTheme } from "@/providers/theme-provider";

export default function FieldAccountScreen() {
  const { colors } = useTheme();
  const { languageName, rowDirection, t, textStyle } = useFieldI18n();
  const { signOut } = useAuth();
  const queryClient = useQueryClient();
  const bootstrap = useBootstrap();
  const notification = useNotificationStatus();
  const pushTest = useFieldPushTest();
  const notificationsOn = notification.registration?.state === "registered";
  if (bootstrap.isLoading) return <LoadingScreen label={t("loading")} />;
  if (!bootstrap.data) return <ErrorState title={t("prepareAccountError")} message={t("prepareAccountError")} onRetry={() => void bootstrap.refetch()} />;
  const session = bootstrap.data.session;
  const roleLabel = session.role === "specialist" ? t("roleSpecialist") : t("roleDriver");
  const notificationLabel = notification.registration
    ? {
        registered: t("notificationRegistered"),
        muted: t("notificationMuted"),
        simulator: t("notificationSimulator"),
        unsupported: t("notificationUnsupported"),
        no_project_id: t("notificationNoProject"),
        denied: t("notificationDenied"),
        failed: t("notificationFailed"),
      }[notification.registration.state]
    : t("checkingNotifications");
  const testPush = () => {
    pushTest.mutate(undefined, {
      onSuccess: ({ delivery }) => {
        if (delivery.delivered > 0) {
          Alert.alert(t("pushWorksTitle"), t("pushWorksBody"));
          return;
        }
        if (delivery.accepted > 0 || delivery.pending > 0) {
          Alert.alert(
            t("pushSentTitle"),
            t("pushSentBody"),
          );
          return;
        }
        Alert.alert(
          t("pushMissingTitle"),
          delivery.attempted === 0
            ? t("pushNoToken")
            : t("pushRejected"),
        );
      },
      onError: () => Alert.alert(t("pushTestError"), t("notificationFailed")),
    });
  };
  const logout = () => {
    Alert.alert(t("logout"), t("logoutBody"), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("logout"),
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
        <View style={{ flexDirection: rowDirection, alignItems: "center", gap: spacing.md }}>
          <Avatar name={session.displayName} seed={session.userId} size={58} />
          <View style={{ flex: 1, alignItems: textStyle.textAlign === "right" ? "flex-end" : "flex-start", gap: spacing.sm }}>
            <Text style={{ ...type.title3, color: colors.text, ...textStyle }}>{session.displayName}</Text>
            <Badge label={roleLabel} tone="brand" icon={session.role === "specialist" ? "sparkles" : "car"} />
          </View>
        </View>
      </Card>
      <View style={{ gap: spacing.sm }}>
        <SectionHeader title={t("notifications")} />
        <Card>
          <Badge
            label={notificationsOn ? t("enabled") : t("disabled")}
            tone={notificationsOn ? "success" : "warning"}
            icon={notificationsOn ? "checkmark.circle" : "exclamationmark.triangle"}
          />
          <Text selectable style={{ ...type.footnote, color: colors.textSecondary, ...textStyle }}>
            {notificationLabel}
          </Text>
          {notificationsOn ? (
            <PrimaryButton
              label={t("sendTestNotification")}
              icon="bell"
              variant="tinted"
              loading={pushTest.isPending}
              onPress={testPush}
            />
          ) : (
            <PrimaryButton
              label={t("enableNotifications")}
              icon="bell"
              variant="tinted"
              onPress={() => void notification.refresh()}
            />
          )}
        </Card>
      </View>
      <View style={{ gap: spacing.sm }}>
        <SectionHeader title={t("appLanguage")} />
        <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
          <DetailRow icon="globe" label={t("appLanguage")} value={languageName} />
        </Card>
      </View>
      <View style={{ gap: spacing.sm }}>
        <SectionHeader title={t("legalSupport")} />
        <LegalLinks />
      </View>
      <PrimaryButton label={t("logout")} icon="rectangle.portrait.and.arrow.right" tone="danger" variant="tinted" onPress={logout} />
    </ScrollView>
  );
}
