import { useSegments } from "expo-router";
import { useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import Animated, { FadeInUp, FadeOutUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { radius, rtlText, spacing, type } from "@/constants/theme";
import {
  currentConnectionQuality,
  subscribeConnectionQuality,
} from "@/lib/connection-quality";
import { isClockSkewed, subscribeClockSkew } from "@/lib/server-clock";
import { useTheme } from "@/providers/theme-provider";

const COPY = {
  slow: "الاتصال بطيء — قد يتأخر التحميل والإرسال",
  offline: "لا يوجد اتصال بالإنترنت — تحققي من الشبكة",
  clock: "ساعة الهاتف غير مضبوطة — فعّلي «الوقت التلقائي» من إعدادات الهاتف",
} as const;

/**
 * Tells the employee her connection is the problem before a request fails, so
 * a slow screen or a failed send is not mistaken for the app signing her out.
 * Purely informational: it never takes a touch from the screen beneath.
 */
export function ConnectionBanner() {
  const quality = useSyncExternalStore(
    subscribeConnectionQuality,
    currentConnectionQuality,
    currentConnectionQuality,
  );
  const clockSkewed = useSyncExternalStore(subscribeClockSkew, isClockSkewed, isClockSkewed);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  // Field screens speak the specialist's own language; this copy is Arabic.
  const inField = useSegments()[0] === "field";

  if (inField) return null;
  // A wrong clock outranks a slow connection: it is the employee's to fix,
  // and it makes the app slower for everyone until she does.
  const state = clockSkewed ? "clock" : quality;
  if (state === "good") return null;
  const offline = state === "offline" || state === "clock";

  return (
    <Animated.View
      entering={FadeInUp}
      exiting={FadeOutUp}
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={{
        position: "absolute",
        top: insets.top + spacing.xs,
        left: spacing.lg,
        right: spacing.lg,
        zIndex: 999,
        alignItems: "center",
      }}
    >
      <View
        style={{
          flexDirection: "row-reverse",
          alignItems: "center",
          gap: spacing.sm,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.xs,
          borderRadius: radius.full,
          backgroundColor: offline ? colors.dangerSoft : colors.warningSoft,
          borderWidth: 1,
          borderColor: offline ? colors.danger : colors.warning,
        }}
      >
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: offline ? colors.danger : colors.warning,
          }}
        />
        <Text
          style={{
            ...type.footnote,
            ...rtlText,
            color: offline ? colors.danger : colors.warning,
          }}
        >
          {COPY[state]}
        </Text>
      </View>
    </Animated.View>
  );
}
