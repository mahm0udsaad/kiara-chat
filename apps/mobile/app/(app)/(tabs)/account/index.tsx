import { useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { PrimaryButton } from "@/components/primary-button";
import { LegalLinks } from "@/components/legal-links";
import { ErrorState, LoadingScreen } from "@/components/screen-state";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, Divider } from "@/components/ui/card";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { DetailRow, SectionHeader } from "@/components/ui/detail-row";
import { rtlText, spacing, type } from "@/constants/theme";
import { useBootstrap } from "@/lib/queries";
import {
  notificationStateLabel,
  unregisterInboxNotifications,
} from "@/lib/notifications";
import { useNotificationStatus } from "@/providers/notification-provider";
import { useAuth } from "@/providers/auth-provider";
import { useTheme } from "@/providers/theme-provider";

const roleLabels = {
  admin: "الإدارة",
  agent: "خدمة العملاء",
  specialist: "أخصائية",
  driver: "سائق",
} as const;

const capabilityLabels = {
  canTakeConversations: "استلام المحادثات",
  canManageTeam: "إدارة الفريق",
  canViewOrderPrices: "عرض أسعار الطلبات",
  canViewReports: "تقارير المالكة",
} as const;

export default function AccountScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const bootstrap = useBootstrap();
  const { signOut } = useAuth();
  const queryClient = useQueryClient();
  const notification = useNotificationStatus();
  const notificationsOn = notification.registration?.state === "registered";
  const notificationsMuted = notification.registration?.state === "muted";

  if (bootstrap.isLoading) return <LoadingScreen />;
  if (bootstrap.isError || !bootstrap.data) {
    return (
      <ErrorState
        title="تعذر تحميل الحساب"
        message={bootstrap.error?.message ?? "تعذر تحميل الحساب"}
        onRetry={() => void bootstrap.refetch()}
      />
    );
  }

  const { session, capabilities } = bootstrap.data;
  const teamMember = bootstrap.data.agents.find((agent) => agent.id === session.teamMemberId);
  const displayName = teamMember?.fullName || session.email || "حساب كيارا";

  const confirmLogout = () => {
    Alert.alert("تسجيل الخروج", "سيتم إغلاق الجلسة على هذا الجهاز.", [
      { text: "رجوع", style: "cancel" },
      {
        text: "تسجيل الخروج",
        style: "destructive",
        onPress: async () => {
          await unregisterInboxNotifications().catch(() => undefined);
          queryClient.clear();
          await signOut();
        },
      },
    ]);
  };

  const grantedCapabilities = (
    Object.keys(capabilityLabels) as (keyof typeof capabilityLabels)[]
  ).filter((key) => capabilities[key]);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        padding: spacing.lg,
        gap: spacing.xl,
        paddingBottom: spacing["4xl"],
      }}
    >
      {/* Profile */}
      <Card>
        <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.md }}>
          <Avatar name={teamMember?.fullName ?? null} seed={session.userId} size={56} />
          <View style={{ flex: 1, gap: spacing.xs }}>
            <Text
              selectable
              numberOfLines={2}
              style={{ ...type.title3, color: colors.text, ...rtlText }}
            >
              {displayName}
            </Text>
            <Text
              selectable
              style={{ ...type.footnote, color: colors.textSecondary, ...rtlText }}
            >
              {session.email || "لا يوجد بريد إلكتروني"}
            </Text>
          </View>
        </View>

        <Divider />

        <View
          style={{
            flexDirection: "row-reverse",
            flexWrap: "wrap",
            gap: spacing.sm,
            paddingTop: spacing.xs,
          }}
        >
          <Badge label={roleLabels[session.role]} tone="brand" icon="person.crop.circle" />
          {grantedCapabilities.map((key) => (
            <Badge key={key} label={capabilityLabels[key]} tone="neutral" icon="checkmark" />
          ))}
        </View>
      </Card>

      {/* استهدافات — bulk campaigns to customer segments. All staff. */}
      <View style={{ gap: spacing.sm }}>
        <SectionHeader title="التسويق" />
        <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/campaigns" as never)}
            style={{
              flexDirection: "row-reverse",
              alignItems: "center",
              justifyContent: "space-between",
              paddingVertical: spacing.md,
            }}
          >
            <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}>
              <IconSymbol name="paperplane.fill" color={colors.brand} size={20} />
              <View>
                <Text style={{ ...type.body, color: colors.text, ...rtlText }}>استهدافات</Text>
                <Text style={{ ...type.footnote, color: colors.textSecondary, ...rtlText }}>
                  إنشاء قوالب وحملات لفئات العملاء
                </Text>
              </View>
            </View>
            <IconSymbol name="chevron.left" color={colors.textTertiary} size={18} />
          </Pressable>
        </Card>
      </View>

      {/* Notifications — a phone that never registered used to look identical
          to one that did, and simply received nothing. */}
      <View style={{ gap: spacing.sm }}>
        <SectionHeader title="الإشعارات" />
        <Card>
          <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}>
            <Badge
              label={notificationsOn ? "مفعّلة" : "غير مفعّلة"}
              tone={notificationsOn ? "success" : "warning"}
              icon={notificationsOn ? "checkmark.circle" : "exclamationmark.triangle"}
            />
          </View>
          <Text style={{ ...type.footnote, color: colors.textSecondary, ...rtlText }}>
            {notification.registration
              ? notification.registration.state === "failed"
                ? notification.registration.message
                : notificationStateLabel[notification.registration.state]
              : "جارٍ التحقق من حالة الإشعارات…"}
          </Text>
          <Text style={{ ...type.footnote, color: colors.textTertiary, ...rtlText }}>
            {notificationsMuted
              ? "لن تصلك تنبيهات على هذا الجهاز حتى تعيدي تفعيلها. باقي أجهزتك لا تتأثر."
              : "تصلك تنبيهات المحادثات الجديدة غير المستلمة، والمحادثات المتأخرة (خطر)، وكل رسالة في محادثاتك."}
          </Text>
          {notificationsOn ? (
            // Off is a real choice — a phone on a shared floor, or a shift that
            // has ended — and without it the only way to stop the alerts was
            // the OS settings, where turning them back on is nobody's guess.
            <PrimaryButton
              label="إيقاف الإشعارات على هذا الجهاز"
              variant="tinted"
              icon="bell.slash"
              onPress={() => void notification.disable()}
            />
          ) : (
            <PrimaryButton
              label={notificationsMuted ? "إعادة تفعيل الإشعارات" : "تفعيل الإشعارات"}
              variant="tinted"
              icon="bell"
              onPress={() => void notification.refresh()}
            />
          )}
        </Card>
      </View>

      {/* About */}
      <View style={{ gap: spacing.sm }}>
        <SectionHeader title="عن التطبيق" />
        <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
          <DetailRow
            icon="info.circle"
            label="إصدار التطبيق"
            monospacedValue
            value={Constants.expoConfig?.version ?? "1.0.0"}
          />
          <Divider inset={46} />
          <DetailRow
            icon="arrow.triangle.2.circlepath"
            label="تحديث البيانات"
            value="إعادة تحميل كل الشاشات"
            actionIcon="arrow.clockwise"
            actionLabel="إعادة تحميل بيانات التطبيق"
            onPress={() => void queryClient.invalidateQueries()}
          />
        </Card>
      </View>

      <View style={{ gap: spacing.sm }}>
        <SectionHeader title="القانونية والدعم" />
        <LegalLinks />
      </View>

      <PrimaryButton
        label="تسجيل الخروج"
        tone="danger"
        variant="tinted"
        icon="rectangle.portrait.and.arrow.right"
        onPress={confirmLogout}
      />
    </ScrollView>
  );
}
