import { Pressable, Text, View } from "react-native";

import { IconSymbol, type IconName } from "@/components/ui/icon-symbol";
import { hitSize, radius, rtlText, spacing, type } from "@/constants/theme";
import { useTheme } from "@/providers/theme-provider";

type Props = {
  icon: IconName;
  label: string;
  value: string;
  /** Turns the row into a button (call, open maps, …). */
  onPress?: () => void;
  actionIcon?: IconName;
  actionLabel?: string;
  tone?: "default" | "muted";
  monospacedValue?: boolean;
};

/**
 * Label-over-value row. The label stays small and quiet while the value carries
 * the weight, so a screen of facts can be scanned by value alone.
 */
export function DetailRow({
  icon,
  label,
  value,
  onPress,
  actionIcon = "chevron.left",
  actionLabel,
  tone = "default",
  monospacedValue = false,
}: Props) {
  const { colors } = useTheme();

  const body = (
    <>
      <View
        style={{
          width: 34,
          height: 34,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: radius.sm + 2,
          backgroundColor: colors.surfaceSunken,
        }}
      >
        <IconSymbol name={icon} color={colors.textSecondary} size={17} />
      </View>

      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...type.caption, color: colors.textTertiary, ...rtlText }}>{label}</Text>
        <Text
          selectable
          style={{
            ...type.calloutStrong,
            color: tone === "muted" ? colors.textTertiary : colors.text,
            ...(monospacedValue ? { fontVariant: ["tabular-nums" as const] } : {}),
            ...rtlText,
          }}
        >
          {value}
        </Text>
      </View>

      {onPress ? <IconSymbol name={actionIcon} color={colors.brand} size={18} /> : null}
    </>
  );

  if (!onPress) {
    return (
      <View
        style={{
          flexDirection: "row-reverse",
          alignItems: "center",
          gap: spacing.md,
          paddingVertical: spacing.md,
        }}
      >
        {body}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={actionLabel ?? `${label}: ${value}`}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: hitSize.comfortable,
        flexDirection: "row-reverse",
        alignItems: "center",
        gap: spacing.md,
        paddingVertical: spacing.md,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      {body}
    </Pressable>
  );
}

/** Small uppercase-style heading that introduces a grouped section. */
export function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row-reverse",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: spacing.xs,
        paddingTop: spacing.xs,
      }}
    >
      <Text style={{ ...type.subheadStrong, color: colors.textSecondary, ...rtlText }}>
        {title}
      </Text>
      {action}
    </View>
  );
}
