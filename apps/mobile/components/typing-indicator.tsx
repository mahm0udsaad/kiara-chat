import { useEffect } from "react";
import { Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { radius, rtlText, spacing, type } from "@/constants/theme";
import { useTheme } from "@/providers/theme-provider";

function TypingDot({ delay }: { delay: number }) {
  const { colors } = useTheme();
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(reduceMotion ? 1 : 0.28);
  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  useEffect(() => {
    if (reduceMotion) {
      opacity.set(1);
      return;
    }
    opacity.set(withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 320 }),
          withTiming(0.28, { duration: 320 }),
        ),
        -1,
      ),
    ));
    return () => cancelAnimation(opacity);
  }, [delay, opacity, reduceMotion]);

  return (
    <Animated.View
      style={[
        {
          width: 5,
          height: 5,
          borderRadius: radius.full,
          backgroundColor: colors.brand,
        },
        animatedStyle,
      ]}
    />
  );
}

export function TypingIndicator({ label = true }: { label?: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel="العميلة تكتب الآن"
      style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}
    >
      {label ? (
        <Text style={{ ...type.footnote, fontWeight: "700", color: colors.brand, ...rtlText }}>
          يكتب الآن
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
        <TypingDot delay={0} />
        <TypingDot delay={140} />
        <TypingDot delay={280} />
      </View>
    </View>
  );
}
