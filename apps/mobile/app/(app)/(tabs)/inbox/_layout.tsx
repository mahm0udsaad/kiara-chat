import { Stack } from "expo-router/stack";

import { useTheme } from "@/providers/theme-provider";

export default function InboxLayout() {
  const { colors } = useTheme();

  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.brand,
        headerTitleStyle: { color: colors.text },
        headerStyle: { backgroundColor: colors.surface },
        headerShadowVisible: false,
        headerBackButtonDisplayMode: "minimal",
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: "المحادثات", headerLargeTitle: true }} />
      <Stack.Screen name="[id]" options={{ title: "المحادثة" }} />
    </Stack>
  );
}
