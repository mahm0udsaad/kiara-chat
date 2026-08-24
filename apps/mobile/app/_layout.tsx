import { Stack } from "expo-router/stack";
import { StatusBar } from "expo-status-bar";
import { I18nManager } from "react-native";
import * as Updates from "expo-updates";

import { AppProviders } from "@/providers/app-providers";
import { useTheme } from "@/providers/theme-provider";

// The app is Arabic-first and always laid out right-to-left. forceRTL persists
// the flag natively, but it only takes effect on the *next* bundle load — so on
// a fresh install the first launch would render LTR (mirrored) until the app was
// killed and reopened. Persisting the flag and reloading once makes the very
// first frame already RTL. Self-limiting: once isRTL sticks this block never runs
// again. Scoped to production so dev Fast Refresh doesn't reload in a loop.
I18nManager.allowRTL(true);
I18nManager.swapLeftAndRightInRTL(true);
if (!I18nManager.isRTL) {
  I18nManager.forceRTL(true);
  if (!__DEV__) void Updates.reloadAsync().catch(() => {});
}

/**
 * Shared header treatment: large titles on roots, blurred translucent bars, and
 * a minimal back button so long Arabic screen titles are not truncated by the
 * previous screen's title.
 */
function RootNavigator() {
  const { colors } = useTheme();

  return (
    <>
      <StatusBar style="dark" />
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
        <Stack.Screen name="field" options={{ headerShown: false }} />
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
