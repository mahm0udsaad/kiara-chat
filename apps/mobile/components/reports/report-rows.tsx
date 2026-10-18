import { Link, type Href } from "expo-router";
import type { PropsWithChildren, ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/ui/card";
import { IconSymbol, type IconName } from "@/components/ui/icon-symbol";
import { hitSize, numeric, radius, rtlText, spacing, type } from "@/constants/theme";
import { reportInteger } from "@/lib/operations-report";
import { useTheme } from "@/providers/theme-provider";

/**
 * Compact report building blocks.
 *
 * The tile grid gave every number the same 126pt card, so a section of six
 * figures took a full screen and the one that mattered looked like the rest.
 * These read like a settings list instead: a strip for the two or three
 * headline numbers, then dense rows for the detail, each still one tap from
 * the conversations behind it.
 */

export type ReportTone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

function useToneColor() {
  const { colors } = useTheme();
  return (tone: ReportTone) =>
    ({
      neutral: colors.text,
      brand: colors.brand,
      success: colors.success,
      warning: colors.warning,
      danger: colors.danger,
      info: colors.info,
    })[tone];
}

const format = (value: number | string) =>
  typeof value === "number" ? reportInteger.format(value) : value;

/** A titled card holding rows, separated by hairlines. */
export function ReportGroup({
  title,
  description,
  accessory,
  footer,
  children,
}: PropsWithChildren<{
  title: string;
  description?: string;
  /** Shown beside the title, e.g. a source badge. */
  accessory?: ReactNode;
  footer?: ReactNode;
}>) {
  const { colors } = useTheme();
  return (
    <Card padded={false}>
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm, gap: spacing.xs }}>
        <View style={{ flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", gap: spacing.sm }}>
          <Text style={{ ...type.headline, ...rtlText, flexShrink: 1, color: colors.text }}>{title}</Text>
          {accessory}
        </View>
        {description ? (
          <Text style={{ ...type.footnote, ...rtlText, color: colors.textSecondary }}>{description}</Text>
        ) : null}
      </View>
      {children}
      {footer ? (
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.lg }}>
          {footer}
        </View>
      ) : (
        <View style={{ height: spacing.sm }} />
      )}
    </Card>
  );
}

export function RowDivider() {
  const { colors } = useTheme();
  return (
    <View style={{ height: StyleSheet.hairlineWidth, marginHorizontal: spacing.lg, backgroundColor: colors.border }} />
  );
}

/** One figure on one line: icon, label (and caption), value, chevron when it opens a list. */
export function ReportRow({
  icon,
  label,
  caption,
  value,
  tone = "neutral",
  href,
  testID,
}: {
  icon?: IconName;
  label: string;
  caption?: string;
  value: number | string;
  tone?: ReportTone;
  href?: Href;
  testID?: string;
}) {
  const { colors } = useTheme();
  const toneColor = useToneColor();
  const content = (
    <View
      style={{
        minHeight: hitSize.comfortable,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.sm,
        flexDirection: "row-reverse",
        alignItems: "center",
        gap: spacing.md,
      }}
    >
      {icon ? (
        <View
          style={{
            width: 30,
            height: 30,
            borderRadius: radius.md,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.surfaceSunken,
          }}
        >
          <IconSymbol name={icon} size={16} color={tone === "neutral" ? colors.textSecondary : toneColor(tone)} />
        </View>
      ) : null}
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={{ ...type.callout, ...rtlText, color: colors.text }}>{label}</Text>
        {caption ? (
          <Text selectable style={{ ...type.caption, ...numeric, ...rtlText, color: colors.textTertiary }}>{caption}</Text>
        ) : null}
      </View>
      <Text selectable style={{ ...type.calloutStrong, ...numeric, color: toneColor(tone) }}>{format(value)}</Text>
      {href ? <IconSymbol name="chevron.left" size={15} color={colors.textTertiary} /> : null}
    </View>
  );
  if (!href) return content;
  return (
    <Link href={href} asChild>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${label}، ${format(value)}`}
        accessibilityHint="يفتح القائمة"
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      >
        {content}
      </Pressable>
    </Link>
  );
}

export type StripFigure = {
  label: string;
  value: number | string;
  tone?: ReportTone;
  href?: Href;
  testID?: string;
};

/** Two to four headline numbers side by side, each opening its list. */
export function FigureStrip({ figures }: { figures: StripFigure[] }) {
  const { colors } = useTheme();
  const toneColor = useToneColor();
  return (
    <View style={{ flexDirection: "row-reverse", paddingHorizontal: spacing.sm }}>
      {figures.map((figure, index) => {
        const body = (
          <View style={{ paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, gap: 2 }}>
            <Text selectable style={{ ...type.title2, ...numeric, ...rtlText, color: toneColor(figure.tone ?? "neutral") }}>
              {format(figure.value)}
            </Text>
            <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: 2 }}>
              <Text numberOfLines={1} style={{ ...type.caption, ...rtlText, flexShrink: 1, color: colors.textSecondary }}>
                {figure.label}
              </Text>
              {figure.href ? <IconSymbol name="chevron.left" size={11} color={colors.textTertiary} /> : null}
            </View>
          </View>
        );
        return (
          <View
            key={figure.label}
            style={{
              flex: 1,
              borderRightWidth: index ? StyleSheet.hairlineWidth : 0,
              borderColor: colors.border,
            }}
          >
            {figure.href ? (
              <Link href={figure.href} asChild>
                <Pressable
                  testID={figure.testID}
                  accessibilityRole="button"
                  accessibilityLabel={`${figure.label}، ${format(figure.value)}`}
                  accessibilityHint="يفتح القائمة"
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                >
                  {body}
                </Pressable>
              </Link>
            ) : body}
          </View>
        );
      })}
    </View>
  );
}

/** A thin stacked bar: how a whole splits, at a glance. */
export function ShareBar({ segments }: { segments: { value: number; tone: ReportTone }[] }) {
  const { colors } = useTheme();
  const toneColor = useToneColor();
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        marginHorizontal: spacing.lg,
        marginVertical: spacing.sm,
        height: 8,
        borderRadius: radius.full,
        overflow: "hidden",
        flexDirection: "row-reverse",
        backgroundColor: colors.surfaceSunken,
      }}
    >
      {total
        ? segments.map((segment, index) =>
            segment.value ? (
              <View key={index} style={{ flex: segment.value, backgroundColor: toneColor(segment.tone) }} />
            ) : null,
          )
        : null}
    </View>
  );
}

/** A pill beside a group title. */
export function SourceBadge({ label, tone }: { label: string; tone: "success" | "warning" }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: spacing.sm,
        paddingVertical: 2,
        borderRadius: radius.full,
        backgroundColor: tone === "success" ? colors.successSoft : colors.warningSoft,
      }}
    >
      <Text style={{ ...type.caption, color: tone === "success" ? colors.onSuccessSoft : colors.onWarningSoft }}>
        {label}
      </Text>
    </View>
  );
}
