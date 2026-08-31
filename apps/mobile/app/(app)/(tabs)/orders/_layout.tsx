import { Stack } from "expo-router/stack";

import { useTheme } from "@/providers/theme-provider";

export default function OrdersLayout() {
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
      <Stack.Screen name="index" options={{ title: "الطلبات" }} />
      <Stack.Screen name="[id]/index" options={{ title: "تفاصيل الطلب" }} />
      <Stack.Screen name="[id]/status" options={{ title: "حالة التنفيذ" }} />
      <Stack.Screen name="[id]/activity" options={{ title: "سجل الإجراءات" }} />
      <Stack.Screen
        name="[id]/remind"
        options={{ title: "إرسال تذكير", presentation: "modal" }}
      />
      <Stack.Screen
        name="[id]/edit"
        options={{ title: "تعديل الطلب", presentation: "modal" }}
      />
      <Stack.Screen
        name="[id]/dispatch"
        options={{ title: "تأكيد الإرسال", presentation: "modal" }}
      />
      <Stack.Screen
        name="[id]/analysis"
        options={{ title: "تحليل رضا العميلة", presentation: "modal" }}
      />
    </Stack>
  );
}
