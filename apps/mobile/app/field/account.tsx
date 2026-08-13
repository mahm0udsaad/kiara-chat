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
import { useBootstrap } from "@/lib/queries";
import { unregisterFieldNotifications } from "@/lib/notifications";
import { useAuth } from "@/providers/auth-provider";
import { useTheme } from "@/providers/theme-provider";

export default function FieldAccountScreen() {
  const { colors } = useTheme();
  const { signOut } = useAuth();
  const queryClient = useQueryClient();
  const bootstrap = useBootstrap();
  if (bootstrap.isLoading) return <LoadingScreen />;
  if (!bootstrap.data) return <ErrorState title="تعذر تحميل الحساب" message={bootstrap.error?.message ?? "تعذر تحميل الحساب"} onRetry={() => void bootstrap.refetch()} />;
  const session = bootstrap.data.session;
  const roleLabel = session.role === "specialist" ? "أخصائية" : "سائق";
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
        <SectionHeader title="القانونية والدعم" />
        <LegalLinks />
      </View>
      <PrimaryButton label="تسجيل الخروج" icon="rectangle.portrait.and.arrow.right" tone="danger" variant="tinted" onPress={logout} />
    </ScrollView>
  );
}
