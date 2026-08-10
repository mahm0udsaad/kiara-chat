import { Stack, useRouter } from "expo-router";
import { ScrollView } from "react-native";

import { EmptyState } from "@/components/screen-state";
import { spacing } from "@/constants/theme";
import { useTheme } from "@/providers/theme-provider";

export default function NotFoundScreen() {
  const { colors } = useTheme();
  const router = useRouter();

  return (
    <>
      <Stack.Screen options={{ title: "الصفحة غير موجودة" }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: spacing.lg }}
      >
        <EmptyState
          icon="exclamationmark.circle"
          title="لم نتمكن من فتح هذه الصفحة"
          detail="قد يكون الرابط قديمًا أو غير صحيح."
          action={{ label: "العودة إلى التطبيق", onPress: () => router.replace("/") }}
        />
      </ScrollView>
    </>
  );
}
