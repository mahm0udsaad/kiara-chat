import { useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";
import { Alert, ScrollView, Text, View } from "react-native";

import { PrimaryButton } from "@/components/primary-button";
import { ErrorState, LoadingScreen } from "@/components/screen-state";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, Divider } from "@/components/ui/card";
import { DetailRow, SectionHeader } from "@/components/ui/detail-row";
import { Segmented } from "@/components/ui/segmented";
import { rtlText, spacing, type } from "@/constants/theme";
import { useBootstrap } from "@/lib/queries";
import { useAuth } from "@/providers/auth-provider";
import { type AppearancePreference, useTheme } from "@/providers/theme-provider";

const roleLabels = {
  admin: "الإدارة",
  agent: "خدمة العملاء",
} as const;

const capabilityLabels = {
  canTakeConversations: "استلام المحادثات",
  canManageTeam: "إدارة الفريق",
  canViewOrderPrices: "عرض أسعار الطلبات",
} as const;

export default function AccountScreen() {
  const { colors, preference, setPreference } = useTheme();
  const bootstrap = useBootstrap();
  const { signOut } = useAuth();
  const queryClient = useQueryClient();

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
        onPress: () => {
          queryClient.clear();
          void signOut();
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

      {/* Appearance */}
      <View style={{ gap: spacing.sm }}>
        <SectionHeader title="المظهر" />
        <Card>
          <Segmented
            accessibilityLabel="مظهر التطبيق"
            options={[
              { value: "system", label: "النظام" },
              { value: "light", label: "فاتح" },
              { value: "dark", label: "داكن" },
            ]}
            value={preference}
            onChange={(next) => setPreference(next as AppearancePreference)}
          />
          <Text style={{ ...type.footnote, color: colors.textTertiary, ...rtlText }}>
            «النظام» يتبع إعداد الوضع الليلي في جهازك تلقائيًا.
          </Text>
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
