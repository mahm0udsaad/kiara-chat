import { Stack } from "expo-router/stack";
import { useTheme } from "@/providers/theme-provider";

export default function ReportsLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.brand,
        headerTitleStyle: { color: colors.text },
        headerStyle: { backgroundColor: colors.surface },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: "تقارير العمليات" }} />
      <Stack.Screen
        name="[role]/[personId]"
        options={{ title: "تفاصيل الأداء", headerBackButtonDisplayMode: "minimal" }}
      />
    </Stack>
  );
}
