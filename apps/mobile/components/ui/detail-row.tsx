import { Pressable, Text, View } from "react-native";

import { IconSymbol, type IconName } from "@/components/ui/icon-symbol";
import { hitSize, radius, spacing, type } from "@/constants/theme";
import { useFieldI18n } from "@/lib/field-i18n";
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
  actionIcon,
  actionLabel,
  tone = "default",
  monospacedValue = false,
}: Props) {
  const { colors } = useTheme();
  const { isRtl, rowDirection, textStyle } = useFieldI18n();
  const resolvedActionIcon = actionIcon ?? (isRtl ? "chevron.left" : "chevron.right");

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
        <Text style={{ ...type.caption, color: colors.textTertiary, ...textStyle }}>{label}</Text>
        <Text
          selectable
          style={{
            ...type.calloutStrong,
            color: tone === "muted" ? colors.textTertiary : colors.text,
            ...(monospacedValue ? { fontVariant: ["tabular-nums" as const] } : {}),
            ...textStyle,
          }}
        >
          {value}
        </Text>
      </View>

      {onPress ? <IconSymbol name={resolvedActionIcon} color={colors.brand} size={18} /> : null}
    </>
  );

  if (!onPress) {
    return (
      <View
        style={{
          flexDirection: rowDirection,
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
        flexDirection: rowDirection,
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
  const { rowDirection, textStyle } = useFieldI18n();
  return (
    <View
      style={{
        flexDirection: rowDirection,
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: spacing.xs,
        paddingTop: spacing.xs,
      }}
    >
      <Text style={{ ...type.subheadStrong, color: colors.textSecondary, ...textStyle }}>
        {title}
      </Text>
      {action}
    </View>
  );
}
