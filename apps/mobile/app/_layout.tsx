import { Stack } from "expo-router/stack";
import { StatusBar } from "expo-status-bar";
import { I18nManager } from "react-native";

import { AppProviders } from "@/providers/app-providers";
import { useTheme } from "@/providers/theme-provider";

I18nManager.allowRTL(true);
I18nManager.forceRTL(true);

/**
 * Shared header treatment: large titles on roots, blurred translucent bars, and
 * a minimal back button so long Arabic screen titles are not truncated by the
 * previous screen's title.
 */
function RootNavigator() {
  const { colors, scheme } = useTheme();

  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerTitleAlign: "center",
          headerTintColor: colors.brand,
          headerTitleStyle: { color: colors.text },
          headerStyle: { backgroundColor: colors.surface },
          headerShadowVisible: false,
          headerBackButtonDisplayMode: "minimal",
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(app)" options={{ headerShown: false }} />
        <Stack.Screen name="session/[token]" options={{ title: "جلسات اليوم" }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <AppProviders>
      <RootNavigator />
    </AppProviders>
  );
}
