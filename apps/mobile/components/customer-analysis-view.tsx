import { Text, View } from "react-native";

import { Badge } from "@/components/ui/badge";
import { Card, Divider } from "@/components/ui/card";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { radius, rtlText, spacing, type } from "@/constants/theme";
import { useTheme } from "@/providers/theme-provider";
import type { CustomerAnalysisResult } from "@/types/api";

/**
 * The AI read of a customer's experience, rendered.
 *
 * Shared by the order-scoped analysis screen and the customer profile so the
 * same verdict cannot end up looking like two different verdicts depending on
 * where it was opened from. The component only renders — every caller owns its
 * own loading, error and re-run affordances, because those differ: the order
 * screen is a modal that analyses on mount, the profile analyses on demand.
 */

const trendLabels = {
  improving: "في تحسّن",
  steady: "مستقر",
  declining: "في تراجع",
  unknown: "غير واضح",
} as const;

export function Score({ value, label }: { value: number; label: string }) {
  const { colors } = useTheme();
  const normalized = Math.max(0, Math.min(100, value));
  const tone =
    normalized >= 75 ? colors.success : normalized >= 50 ? colors.warning : colors.danger;
  const soft =
    normalized >= 75
      ? colors.successSoft
      : normalized >= 50
        ? colors.warningSoft
        : colors.dangerSoft;

  return (
    <View style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.md }}>
        <View
          style={{
            width: 64,
            height: 64,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: radius.full,
            backgroundColor: soft,
          }}
        >
          <Text
            selectable
            style={{ ...type.title2, color: tone, fontVariant: ["tabular-nums"] }}
          >
            {normalized}
          </Text>
          <Text style={{ ...type.caption, color: tone }}>من ١٠٠</Text>
        </View>
        <View style={{ flex: 1, gap: spacing.xs }}>
          <Text selectable style={{ ...type.caption, color: colors.textTertiary, ...rtlText }}>
            {label}
          </Text>
          <Text selectable style={{ ...type.title3, color: tone, ...rtlText }}>
            {normalized}/١٠٠
          </Text>
        </View>
      </View>
      <View
        style={{
          height: 8,
          overflow: "hidden",
          borderRadius: radius.full,
          backgroundColor: colors.surfaceSunken,
        }}
      >
        <View
          style={{
            width: `${normalized}%`,
            height: "100%",
            borderRadius: radius.full,
            backgroundColor: tone,
          }}
        />
      </View>
    </View>
  );
}

export function BulletList({ items, color }: { items: string[]; color: string }) {
  if (!items.length) return null;
  return (
    <View style={{ gap: spacing.sm }}>
      {items.map((item, index) => (
        <View key={`${index}-${item}`} style={{ flexDirection: "row-reverse", gap: spacing.sm }}>
          <Text style={{ ...type.body, color }}>•</Text>
          <Text selectable style={{ flex: 1, ...type.callout, color, ...rtlText }}>
            {item}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function CustomerAnalysisView({
  analysis,
}: {
  analysis: CustomerAnalysisResult;
}) {
  const { colors } = useTheme();

  return (
    <View style={{ gap: spacing.lg }}>
      <Card variant="raised">
        <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.md }}>
          <View
            style={{
              width: 48,
              height: 48,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: radius.full,
              backgroundColor: colors.brandSoft,
            }}
          >
            <IconSymbol name="sparkles" color={colors.brand} size={22} />
          </View>
          <View style={{ flex: 1, gap: spacing.xs }}>
            <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}>
              <Text selectable style={{ ...type.headline, color: colors.text, ...rtlText }}>
                {analysis.satisfaction.label}
              </Text>
              <Badge label={trendLabels[analysis.trend]} tone="info" />
            </View>
            <Text selectable style={{ ...type.callout, color: colors.textSecondary, ...rtlText }}>
              {analysis.satisfaction.summary}
            </Text>
          </View>
        </View>
        <Divider />
        <Score value={analysis.satisfaction.score} label="رضا العميلة" />
      </Card>

      {analysis.redFlags.length ? (
        <Card style={{ backgroundColor: colors.dangerSoft, borderColor: colors.dangerSoft }}>
          <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}>
            <IconSymbol name="exclamationmark.triangle" color={colors.onDangerSoft} size={18} />
            <Text selectable style={{ ...type.headline, color: colors.onDangerSoft, ...rtlText }}>
              تحتاج انتباهًا
            </Text>
          </View>
          <BulletList items={analysis.redFlags} color={colors.onDangerSoft} />
        </Card>
      ) : null}

      <Card>
        <Text selectable style={{ ...type.headline, color: colors.text, ...rtlText }}>
          جودة تواصل الموظفات
        </Text>
        <Score value={analysis.staff.rating} label="تقييم التواصل" />
        {analysis.staff.strengths.length ? (
          <View style={{ gap: spacing.sm }}>
            <Text selectable style={{ ...type.subheadStrong, color: colors.success, ...rtlText }}>
              نقاط القوة
            </Text>
            <BulletList items={analysis.staff.strengths} color={colors.onSuccessSoft} />
          </View>
        ) : null}
        {analysis.staff.issues.length ? (
          <View style={{ gap: spacing.sm }}>
            <Text selectable style={{ ...type.subheadStrong, color: colors.warning, ...rtlText }}>
              فرص التحسين
            </Text>
            <BulletList items={analysis.staff.issues} color={colors.onWarningSoft} />
          </View>
        ) : null}
      </Card>

      {analysis.recommendations.length ? (
        <Card style={{ backgroundColor: colors.infoSoft, borderColor: colors.infoSoft }}>
          <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}>
            <IconSymbol name="info.circle" color={colors.onInfoSoft} size={18} />
            <Text selectable style={{ ...type.headline, color: colors.onInfoSoft, ...rtlText }}>
              توصيات لرفع الرضا
            </Text>
          </View>
          <BulletList items={analysis.recommendations} color={colors.onInfoSoft} />
        </Card>
      ) : null}

      <Text selectable style={{ ...type.caption, color: colors.textTertiary, ...rtlText }}>
        بُني التحليل على {analysis.basis.messages} رسالة و{analysis.basis.bookings} حجز. التحليل
        آلي وقد يخطئ، لذلك راجعي المحادثة قبل اتخاذ قرار.
      </Text>
    </View>
  );
}
