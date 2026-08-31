import { Redirect } from "expo-router";
import { Stack } from "expo-router/stack";

import { LoadingScreen } from "@/components/screen-state";
import { useAuth } from "@/providers/auth-provider";
import { useTheme } from "@/providers/theme-provider";

export default function AppLayout() {
  const { session, loading } = useAuth();
  const { colors } = useTheme();
  if (loading) return <LoadingScreen />;
  if (!session) return <Redirect href="/login" />;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      {/* The customer profile sits above the tabs, not inside one: it is
          opened from a chat and from the calendar alike, and neither tab owns
          a customer. Pushed here, it keeps one instance and one back stack. */}
      <Stack.Screen
        name="customer/[phone]/index"
        options={{
          headerShown: true,
          title: "ملف العميلة",
          headerTintColor: colors.brand,
          headerTitleStyle: { color: colors.text },
          headerStyle: { backgroundColor: colors.surface },
          headerShadowVisible: false,
          headerBackButtonDisplayMode: "minimal",
          contentStyle: { backgroundColor: colors.background },
        }}
      />
      <Stack.Screen
        name="customer/[phone]/report"
        options={{
          headerShown: true,
          title: "سجل المسؤولية",
          headerTintColor: colors.brand,
          headerTitleStyle: { color: colors.text },
          headerStyle: { backgroundColor: colors.surface },
          headerShadowVisible: false,
          headerBackButtonDisplayMode: "minimal",
          contentStyle: { backgroundColor: colors.background },
        }}
      />
    </Stack>
  );
}
