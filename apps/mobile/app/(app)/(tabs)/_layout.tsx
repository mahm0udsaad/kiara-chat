import { Redirect, usePathname } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { View } from "react-native";

import { PrimaryButton } from "@/components/primary-button";
import { EmptyState, ErrorState, LoadingScreen } from "@/components/screen-state";
import { spacing } from "@/constants/theme";
import { useBootstrap, useConversations } from "@/lib/queries";
import { useAuth } from "@/providers/auth-provider";
import { useTheme } from "@/providers/theme-provider";

const customerServiceRoles = new Set(["admin", "agent"]);

export default function TabsLayout() {
  const pathname = usePathname();
  const bootstrap = useBootstrap();
  const { signOut } = useAuth();
  const { colors } = useTheme();
  // Powers the tab badge; shares the inbox screen's cache entry, so this adds
  // no extra traffic.
  const newConversations = useConversations("new", "", { enabled: bootstrap.isSuccess });

  if (bootstrap.isLoading) return <LoadingScreen label="جارٍ تجهيز حسابك…" />;

  if (bootstrap.error && "status" in bootstrap.error && bootstrap.error.status === 401) {
    return <Redirect href="/login" />;
  }

  if (bootstrap.isError) {
    return (
      <ErrorState
        title="تعذر تجهيز الحساب"
        message={bootstrap.error.message}
        onRetry={() => void bootstrap.refetch()}
      />
    );
  }

  if (
    bootstrap.data?.session.role === "specialist" ||
    bootstrap.data?.session.role === "driver"
  ) {
    return <Redirect href="/field/orders" />;
  }

  if (!bootstrap.data || !customerServiceRoles.has(bootstrap.data.session.role)) {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: colors.background }}>
        <EmptyState
          icon="lock"
          title="الواجهة غير متاحة لهذا الدور بعد"
          detail="النسخة الحالية مخصصة لفريق خدمة العملاء والإدارة."
        />
        <View style={{ padding: spacing.xl }}>
          <PrimaryButton
            label="تسجيل الخروج"
            tone="danger"
            variant="tinted"
            icon="rectangle.portrait.and.arrow.right"
            onPress={() => void signOut()}
          />
        </View>
      </View>
    );
  }

  const unreadCount = newConversations.data?.pages[0]?.counts.new ?? 0;
  const isConversationScreen = /^\/inbox\/[^/]+\/?$/.test(pathname);

  return (
    <NativeTabs
      hidden={isConversationScreen}
      tintColor={colors.brand}
      minimizeBehavior="onScrollDown"
    >
      <NativeTabs.Trigger
        name="inbox"
        // The inbox FlatList already owns the native-stack header/search-bar
        // inset. Letting NativeTabs discover and override that same scroll view
        // again on every tab re-attachment makes iOS accumulate the top inset.
        disableAutomaticContentInsets
      >
        <NativeTabs.Trigger.Icon sf={{ default: "message", selected: "message.fill" }} md="chat" />
        <NativeTabs.Trigger.Label>المحادثات</NativeTabs.Trigger.Label>
        {unreadCount > 0 ? (
          <NativeTabs.Trigger.Badge>{String(unreadCount)}</NativeTabs.Trigger.Badge>
        ) : null}
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="orders">
        <NativeTabs.Trigger.Icon
          sf={{ default: "calendar", selected: "calendar.circle.fill" }}
          md="calendar_month"
        />
        <NativeTabs.Trigger.Label>الطلبات</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="account">
        <NativeTabs.Trigger.Icon
          sf={{ default: "person.crop.circle", selected: "person.crop.circle.fill" }}
          md="account_circle"
        />
        <NativeTabs.Trigger.Label>الحساب</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
