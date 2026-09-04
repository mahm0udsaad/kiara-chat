import { Text, View } from "react-native";

import { radius, spacing, type } from "@/constants/theme";
import { useFieldI18n } from "@/lib/field-i18n";
import { IconSymbol, type IconName } from "@/components/ui/icon-symbol";
import { useTheme } from "@/providers/theme-provider";

export type BadgeTone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

type Props = {
  label: string;
  tone?: BadgeTone;
  icon?: IconName;
};

/**
 * Status is never carried by colour alone — every badge pairs its tone with a
 * word, and most also carry an icon, so the meaning survives colour blindness
 * and greyscale.
 */
export function Badge({ label, tone = "neutral", icon }: Props) {
  const { colors } = useTheme();
  const { rowDirection, textStyle } = useFieldI18n();

  const palette: Record<BadgeTone, { bg: string; fg: string }> = {
    neutral: { bg: colors.surfaceSunken, fg: colors.textSecondary },
    brand: { bg: colors.brandSoft, fg: colors.onBrandSoft },
    success: { bg: colors.successSoft, fg: colors.onSuccessSoft },
    warning: { bg: colors.warningSoft, fg: colors.onWarningSoft },
    danger: { bg: colors.dangerSoft, fg: colors.onDangerSoft },
    info: { bg: colors.infoSoft, fg: colors.onInfoSoft },
  };
  const { bg, fg } = palette[tone];

  return (
    <View
      style={{
        flexDirection: rowDirection,
        alignItems: "center",
        gap: spacing.xs,
        paddingHorizontal: spacing.sm + 2,
        paddingVertical: spacing.xs + 1,
        borderRadius: radius.full,
        backgroundColor: bg,
      }}
    >
      {icon ? <IconSymbol name={icon} color={fg} size={13} /> : null}
      <Text style={{ ...type.caption, color: fg, ...textStyle }}>{label}</Text>
    </View>
  );
}

/** Unread/count pill. Large counts are capped so the row never reflows. */
export function CountBadge({ count, tone = "brand" }: { count: number; tone?: "brand" | "danger" }) {
  const { colors } = useTheme();
  if (count <= 0) return null;
  return (
    <View
      style={{
        minWidth: 22,
        height: 22,
        paddingHorizontal: spacing.xs + 2,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radius.full,
        backgroundColor: tone === "danger" ? colors.danger : colors.brand,
      }}
    >
      <Text
        style={{
          ...type.caption,
          color: colors.onBrand,
          fontVariant: ["tabular-nums"],
        }}
      >
        {count > 99 ? "٩٩+" : count}
      </Text>
    </View>
  );
}
