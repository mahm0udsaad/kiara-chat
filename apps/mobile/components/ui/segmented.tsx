import { Pressable, ScrollView, Text, View } from "react-native";

import { hitSize, radius, rtlText, spacing, type } from "@/constants/theme";
import { tapFeedback } from "@/lib/haptics";
import { useTheme } from "@/providers/theme-provider";

export type SegmentOption<T extends string> = {
  value: T;
  label: string;
  /** Rendered as a trailing count pill. */
  count?: number;
};

type Props<T extends string> = {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel: string;
  /** "fill" splits the width evenly; "scroll" keeps labels on one line. */
  layout?: "fill" | "scroll";
};

/**
 * Filter control used across the inbox and orders lists. Every segment clears
 * the 44pt minimum touch target and announces its selected state.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  layout = "fill",
}: Props<T>) {
  const { colors } = useTheme();

  const segments = options.map((option) => {
    const active = option.value === value;
    return (
      <Pressable
        key={option.value}
        accessibilityRole="tab"
        accessibilityLabel={
          option.count === undefined ? option.label : `${option.label}، ${option.count}`
        }
        accessibilityState={{ selected: active }}
        onPress={() => {
          if (!active) tapFeedback();
          onChange(option.value);
        }}
        style={({ pressed }) => ({
          flex: layout === "fill" ? 1 : undefined,
          minHeight: hitSize.min,
          flexDirection: "row-reverse",
          alignItems: "center",
          justifyContent: "center",
          gap: spacing.xs + 2,
          paddingHorizontal: spacing.md + 2,
          borderRadius: radius.md,
          borderCurve: "continuous",
          backgroundColor: active ? colors.surface : "transparent",
          boxShadow: active ? "0 1px 3px rgba(24, 33, 77, 0.12)" : undefined,
          opacity: pressed ? 0.65 : 1,
        })}
      >
        <Text
          numberOfLines={1}
          style={{
            ...type.subheadStrong,
            color: active ? colors.text : colors.textSecondary,
            ...rtlText,
          }}
        >
          {option.label}
        </Text>
        {option.count !== undefined ? (
          <View
            style={{
              minWidth: 20,
              paddingHorizontal: spacing.xs + 1,
              paddingVertical: 1,
              borderRadius: radius.full,
              backgroundColor: active ? colors.brandSoft : colors.surfaceSunken,
            }}
          >
            <Text
              style={{
                ...type.caption,
                textAlign: "center",
                fontVariant: ["tabular-nums"],
                color: active ? colors.onBrandSoft : colors.textTertiary,
              }}
            >
              {option.count}
            </Text>
          </View>
        ) : null}
      </Pressable>
    );
  });

  const track = {
    flexDirection: "row-reverse",
    gap: spacing.xs,
    padding: spacing.xs,
    borderRadius: radius.lg,
    borderCurve: "continuous",
    backgroundColor: colors.surfaceSunken,
  } as const;

  if (layout === "scroll") {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityRole="tablist"
        accessibilityLabel={accessibilityLabel}
        contentContainerStyle={track}
      >
        {segments}
      </ScrollView>
    );
  }

  return (
    <View accessibilityRole="tablist" accessibilityLabel={accessibilityLabel} style={track}>
      {segments}
    </View>
  );
}
