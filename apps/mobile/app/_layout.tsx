import type { ErrorBoundaryProps } from "expo-router";
import { Stack } from "expo-router/stack";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { I18nManager, Platform, Pressable, ScrollView, Text } from "react-native";
import * as Updates from "expo-updates";

import { AppProviders } from "@/providers/app-providers";
import { fieldLocaleForSession } from "@/lib/field-i18n";
import { useBootstrap } from "@/lib/queries";
import { useAuth } from "@/providers/auth-provider";
import { useTheme } from "@/providers/theme-provider";

/**
 * Native navigation direction is process-wide, so change it only after the
 * authenticated bootstrap tells us who is using the device. A reload applies
 * the new direction once; subsequent launches already match and do nothing.
 */
function AppDirectionSync() {
  const { session, loading } = useAuth();
  const bootstrap = useBootstrap(Boolean(session) && !loading);

  useEffect(() => {
    if (Platform.OS === "web" || !bootstrap.data) return;
    const current = bootstrap.data.session;
    const locale = fieldLocaleForSession(
      current.role,
      current.nationality,
      current.preferredLanguage,
    );
    const shouldUseRtl = locale === "ar";
    if (I18nManager.isRTL === shouldUseRtl) return;

    I18nManager.allowRTL(true);
    I18nManager.swapLeftAndRightInRTL(shouldUseRtl);
    I18nManager.forceRTL(shouldUseRtl);
    if (!__DEV__) void Updates.reloadAsync().catch(() => {});
  }, [bootstrap.data]);

  return null;
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

/**
 * Last line of defence for a render that throws.
 *
 * Expo Router picks this up by name. Without it a thrown render error unmounts
 * the tree and leaves a blank screen — from the outside indistinguishable from a
 * frozen app, and with nothing on screen to report or retry from. During a test
 * pass that difference is the whole story: a message and a button say which
 * screen broke, a white rectangle says nothing.
 *
 * Deliberately provider-free. This stands in for the entire tree *including*
 * `AppProviders`, so reaching for the theme or query client here would simply be
 * the second crash. The few colours are inlined from `app.json` on purpose.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: "#F4F6FB" }}
      contentContainerStyle={{
        flexGrow: 1,
        gap: 16,
        padding: 24,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        style={{
          fontSize: 20,
          fontWeight: "600",
          color: "#11181C",
          textAlign: "center",
          writingDirection: "rtl",
        }}
      >
        حدث خطأ غير متوقع
      </Text>
      <Text
        selectable
        accessibilityRole="alert"
        style={{
          fontSize: 15,
          color: "#5B6570",
          textAlign: "center",
          writingDirection: "rtl",
        }}
      >
        {error.message || "تعذر عرض هذه الشاشة."}
      </Text>
      <Pressable
        onPress={() => void retry()}
        accessibilityRole="button"
        style={{
          marginTop: 8,
          paddingVertical: 12,
          paddingHorizontal: 28,
          borderRadius: 12,
          backgroundColor: "#2B3FB0",
        }}
      >
        <Text style={{ color: "#FFFFFF", fontSize: 16, fontWeight: "600" }}>
          إعادة المحاولة
        </Text>
      </Pressable>
    </ScrollView>
  );
}

export default function RootLayout() {
  return (
    <AppProviders>
      <AppDirectionSync />
      <RootNavigator />
    </AppProviders>
  );
}
