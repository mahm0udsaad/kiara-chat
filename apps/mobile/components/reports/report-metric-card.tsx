import { Link, type Href } from "expo-router";
import type { PropsWithChildren } from "react";
import { Pressable, Text, View } from "react-native";

import { IconSymbol, type IconName } from "@/components/ui/icon-symbol";
import { numeric, radius, rtlText, spacing, type } from "@/constants/theme";
import { reportInteger } from "@/lib/operations-report";
import { useTheme } from "@/providers/theme-provider";

export type ReportMetricTone = "brand" | "neutral" | "success" | "warning" | "danger" | "info";

type MetricProps = {
  icon: IconName;
  label: string;
  value: number | string;
  tone?: ReportMetricTone;
  href?: Href;
  testID?: string;
  accessibilityHint?: string;
};

export function ReportMetricGrid({ children }: PropsWithChildren) {
  return (
    <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: spacing.sm }}>
      {children}
    </View>
  );
}

export function ReportSectionHeader({ title, description }: { title: string; description?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={{ ...type.headline, ...rtlText, color: colors.text }}>{title}</Text>
      {description ? (
        <Text style={{ ...type.footnote, ...rtlText, color: colors.textSecondary }}>{description}</Text>
      ) : null}
    </View>
  );
}

export function ReportMetricCard({
  icon,
  label,
  value,
  tone = "neutral",
  href,
  testID,
  accessibilityHint = "يفتح تفاصيل هذه النتيجة",
}: MetricProps) {
  const { colors } = useTheme();
  const palette = {
    brand: { background: colors.brandSoft, foreground: colors.onBrandSoft, border: colors.brandSoft },
    neutral: { background: colors.surface, foreground: colors.brand, border: colors.border },
    success: { background: colors.successSoft, foreground: colors.onSuccessSoft, border: colors.successSoft },
    warning: { background: colors.warningSoft, foreground: colors.onWarningSoft, border: colors.warningSoft },
    danger: { background: colors.dangerSoft, foreground: colors.onDangerSoft, border: colors.dangerSoft },
    info: { background: colors.infoSoft, foreground: colors.onInfoSoft, border: colors.infoSoft },
  }[tone];
  const formattedValue = typeof value === "number" ? reportInteger.format(value) : value;
  const content = (
    <>
      <View style={{ flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", gap: spacing.sm }}>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: radius.md,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: tone === "neutral" ? colors.brandSoft : colors.surface,
          }}
        >
          <IconSymbol name={icon} size={19} color={palette.foreground} />
        </View>
        {href ? <IconSymbol name="chevron.left" size={17} color={palette.foreground} /> : null}
      </View>
      <View style={{ gap: spacing.xs }}>
        <Text style={{ ...type.subheadStrong, ...rtlText, color: colors.textSecondary }}>{label}</Text>
        <Text selectable style={{ ...type.title2, ...numeric, ...rtlText, color: colors.text }}>
          {formattedValue}
        </Text>
      </View>
    </>
  );
  const cardStyle = {
    width: "100%" as const,
    minHeight: 126,
    padding: spacing.md,
    justifyContent: "space-between" as const,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.lg,
    borderCurve: "continuous" as const,
    backgroundColor: palette.background,
  };

  return (
    <View style={{ flexGrow: 1, flexBasis: 148, minWidth: 140 }}>
      {href ? (
        <Link href={href} asChild>
          <Pressable
            testID={testID}
            accessibilityRole="button"
            accessibilityLabel={`${label}، ${formattedValue}`}
            accessibilityHint={accessibilityHint}
            style={({ pressed }) => [cardStyle, { opacity: pressed ? 0.7 : 1 }]}
          >
            {content}
          </Pressable>
        </Link>
      ) : (
        <View style={cardStyle}>{content}</View>
      )}
    </View>
  );
}
