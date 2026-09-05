import { useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { FadeInUp, FadeOutUp } from "react-native-reanimated";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { radius, rtlText, spacing, type } from "@/constants/theme";
import { warningFeedback } from "@/lib/haptics";
import {
  useDismissUnclaimedAlert,
  useUnclaimedAlert,
} from "@/providers/inbox-live-provider";
import { useTheme } from "@/providers/theme-provider";

/**
 * The in-app bell, unique to Kiara: a new message on a thread nobody has
 * claimed, surfaced while the app is open — where the OS shows no push banner.
 * Floats above every screen, taps through to the inbox, and clears itself.
 */
const AUTO_DISMISS_MS = 12_000;

export function UnclaimedBell() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const alert = useUnclaimedAlert();
  const dismiss = useDismissUnclaimedAlert();

  useEffect(() => {
    if (!alert) return;
    warningFeedback();
    const t = setTimeout(dismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [alert, dismiss]);

  if (!alert) return null;

  const who = alert.customerName?.trim() || "عميلة جديدة";

  return (
    <Animated.View
      entering={FadeInUp.springify().damping(18)}
      exiting={FadeOutUp}
      pointerEvents="box-none"
      style={{
        position: "absolute",
        top: insets.top + spacing.sm,
        left: spacing.md,
        right: spacing.md,
        zIndex: 1000,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="محادثة جديدة غير مستلمة"
        onPress={() => {
          dismiss();
          router.push("/inbox" as never);
        }}
        style={{
          flexDirection: "row-reverse",
          alignItems: "center",
          gap: spacing.sm,
          paddingVertical: spacing.md,
          paddingHorizontal: spacing.lg,
          borderRadius: radius.xl,
          backgroundColor: colors.brand,
          shadowColor: "#000",
          shadowOpacity: 0.18,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
          elevation: 8,
        }}
      >
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: 17,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(255,255,255,0.2)",
          }}
        >
          <IconSymbol name="bell" color="#fff" size={18} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ ...type.bodyStrong, color: "#fff", ...rtlText }}>
            محادثة جديدة غير مستلمة
          </Text>
          <Text numberOfLines={1} style={{ ...type.caption, color: "rgba(255,255,255,0.85)", ...rtlText }}>
            {who} بانتظار الرد — اضغطي للاستلام
          </Text>
        </View>
        <Pressable
          hitSlop={10}
          onPress={dismiss}
          accessibilityLabel="تجاهل"
          style={{ padding: 4 }}
        >
          <IconSymbol name="xmark" color="rgba(255,255,255,0.9)" size={16} />
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}
