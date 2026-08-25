import { useRef } from "react";
import { I18nManager, Pressable, ScrollView, Text, View } from "react-native";

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
  testIDPrefix?: string;
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
  testIDPrefix,
}: Props<T>) {
  const { colors } = useTheme();
  const scroller = useRef<ScrollView>(null);
  // A horizontal ScrollView still opens at its left edge under RTL, which hides
  // the first (right-most) filter. Park it on the right once, then leave it be.
  const parked = useRef(false);

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
        testID={testIDPrefix ? `${testIDPrefix}-${option.value}` : undefined}
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
        ref={scroller}
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityRole="tablist"
        accessibilityLabel={accessibilityLabel}
        contentContainerStyle={track}
        onContentSizeChange={(width) => {
          if (parked.current || !I18nManager.isRTL) return;
          parked.current = true;
          // Over-scrolling clamps to the far edge, which under RTL is the first
          // filter. Wait a frame so the ScrollView has measured itself first.
          requestAnimationFrame(() => scroller.current?.scrollTo({ x: width, animated: false }));
        }}
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
