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
      {/* The chat sits above the tabs for the same reason, plus one of its
          own: it is the only screen whose bottom edge is interactive all the
          way down (claim button, then the composer). Inside a tab, the native
          Android tab bar stays in the hierarchy even when `hidden`, and it
          swallows every touch in that strip — the claim button rendered and
          its `onPress` never fired. Pushed here there is no tab bar to hide. */}
      <Stack.Screen
        name="conversation/[id]"
        options={{
          headerShown: true,
          title: "المحادثة",
          headerTintColor: colors.brand,
          headerTitleStyle: { color: colors.text },
          headerStyle: { backgroundColor: colors.surface },
          headerShadowVisible: false,
          headerBackButtonDisplayMode: "minimal",
          contentStyle: { backgroundColor: colors.background },
        }}
      />
      {/* The customer profile sits above the tabs, not inside one: it is
          opened from a chat and from the calendar alike, and neither tab owns
          a customer. Pushed here, it keeps one instance and one back stack. */}
      <Stack.Screen
        name="campaigns/index"
        options={{
          headerShown: true,
          title: "استهدافات",
          headerTintColor: colors.brand,
          headerTitleStyle: { color: colors.text },
          headerStyle: { backgroundColor: colors.surface },
          headerShadowVisible: false,
          headerBackButtonDisplayMode: "minimal",
          contentStyle: { backgroundColor: colors.background },
        }}
      />
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
