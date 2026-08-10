import type { PropsWithChildren } from "react";
import { View, type ViewStyle } from "react-native";

import { radius, spacing } from "@/constants/theme";
import { useTheme } from "@/providers/theme-provider";

type Props = PropsWithChildren<{
  /** "plain" for grouped list sections, "raised" for standalone emphasis. */
  variant?: "plain" | "raised";
  padded?: boolean;
  style?: ViewStyle;
}>;

export function Card({ children, variant = "plain", padded = true, style }: Props) {
  const { colors, shadow } = useTheme();
  return (
    <View
      style={[
        {
          borderRadius: radius.xl,
          borderCurve: "continuous",
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          boxShadow: variant === "raised" ? shadow.raised : shadow.card,
          overflow: "hidden",
        },
        padded && { padding: spacing.lg, gap: spacing.md },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** A hairline divider sized to sit between rows inside a Card. */
export function Divider({ inset = 0 }: { inset?: number }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        height: 1,
        marginStart: inset,
        backgroundColor: colors.border,
      }}
    />
  );
}
