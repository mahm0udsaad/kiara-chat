import { useEffect } from "react";
import { View, type ViewStyle } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { radius, spacing } from "@/constants/theme";
import { useTheme } from "@/providers/theme-provider";

/**
 * Skeletons preserve the final layout while loading, so the list does not jump
 * when data lands. The pulse respects reduced-motion via Reanimated's own
 * system setting handling.
 */
export function Skeleton({
  width,
  height,
  round,
  style,
}: {
  width?: ViewStyle["width"];
  height: number;
  round?: boolean;
  style?: ViewStyle;
}) {
  const { colors } = useTheme();
  const pulse = useSharedValue(0.55);

  useEffect(() => {
    pulse.set(withRepeat(
      withTiming(1, { duration: 850, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    ));
    return () => cancelAnimation(pulse);
  }, [pulse]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[
        {
          width: width ?? "100%",
          height,
          borderRadius: round ? radius.full : radius.sm,
          backgroundColor: colors.skeleton,
        },
        style,
        animatedStyle,
      ]}
    />
  );
}

/** Placeholder matching the conversation/order row layout. */
export function SkeletonRow() {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row-reverse",
        gap: spacing.md,
        padding: spacing.lg,
        borderRadius: radius.xl,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
      }}
    >
      <Skeleton width={44} height={44} round />
      <View style={{ flex: 1, gap: spacing.sm }}>
        <Skeleton width="55%" height={15} />
        <Skeleton width="80%" height={12} />
        <Skeleton width="35%" height={12} />
      </View>
    </View>
  );
}

export function SkeletonList({ count = 5 }: { count?: number }) {
  return (
    <View style={{ gap: spacing.md }}>
      {Array.from({ length: count }, (_, index) => (
        <SkeletonRow key={index} />
      ))}
    </View>
  );
}
