import { Text, View } from "react-native";

import { ReportGroup, ReportRow, RowDivider, SourceBadge } from "@/components/reports/report-rows";
import { numeric, radius, rtlText, spacing, type } from "@/constants/theme";
import { REPORT_LOCALE, reportInteger } from "@/lib/operations-report";
import { useTheme } from "@/providers/theme-provider";
import type { MetaSpend } from "@/types/api";

const riyal = new Intl.NumberFormat(REPORT_LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rate = new Intl.NumberFormat(REPORT_LOCALE, { maximumFractionDigits: 4 });
const dayLabel = new Intl.DateTimeFormat(REPORT_LOCALE, {
  timeZone: "UTC",
  weekday: "short",
  day: "numeric",
  month: "short",
});
const effectiveLabel = new Intl.DateTimeFormat(REPORT_LOCALE, {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
  year: "numeric",
});

export const sarLabel = (value: number) => `${riyal.format(value)} ر.س`;

/** What the WhatsApp Cloud API cost, in riyals: the total, by kind, and day by day. */
export function MetaSpendCard({ spend }: { spend: MetaSpend }) {
  const { colors } = useTheme();
  const maxDay = Math.max(...spend.days.map((day) => day.costSar), 0);
  const average = spend.days.length ? spend.costSar / spend.days.length : 0;
  const { marketing, utility, authentication } = spend.byCategory;
  return (
    <ReportGroup
      title="تكلفة واتساب (Meta)"
      accessory={
        <SourceBadge
          label={spend.source === "meta" ? "من فاتورة Meta" : "تقديري"}
          tone={spend.source === "meta" ? "success" : "warning"}
        />
      }
      footer={
        <Text selectable style={{ ...type.caption, ...numeric, ...rtlText, color: colors.textTertiary }}>
          سعر الرسالة لأرقام السعودية من {effectiveLabel.format(new Date(`${spend.rates.effectiveFrom}T00:00:00Z`))}: تسويقية {rate.format(spend.rates.marketing)} ر.س · خدمية {rate.format(spend.rates.utility)} ر.س · مصادقة {rate.format(spend.rates.authentication)} ر.س. الردود خلال ٢٤ ساعة من آخر رسالة للعميلة مجانية، وكذلك القوالب الخدمية داخلها.
          {spend.note ? `\n${spend.note}` : ""}
        </Text>
      }
    >
      <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, gap: 2 }}>
        <Text selectable style={{ ...type.title1, ...numeric, ...rtlText, color: colors.text }}>
          {sarLabel(spend.costSar)}
        </Text>
        <Text selectable style={{ ...type.footnote, ...numeric, ...rtlText, color: colors.textSecondary }}>
          متوسط {sarLabel(average)} يومياً
        </Text>
      </View>
      <RowDivider />
      <ReportRow
        icon="sparkles"
        label="قوالب تسويقية"
        caption={`${reportInteger.format(marketing.count)} رسالة`}
        value={sarLabel(marketing.costSar)}
        tone={marketing.costSar ? "danger" : "neutral"}
      />
      <RowDivider />
      <ReportRow
        icon="bell"
        label="قوالب خدمية مدفوعة"
        caption={`${reportInteger.format(utility.count)} رسالة خارج نافذة ٢٤ ساعة`}
        value={sarLabel(utility.costSar)}
      />
      {authentication.count ? (
        <>
          <RowDivider />
          <ReportRow
            icon="lock"
            label="قوالب مصادقة"
            caption={`${reportInteger.format(authentication.count)} رسالة`}
            value={sarLabel(authentication.costSar)}
          />
        </>
      ) : null}
      <RowDivider />
      <ReportRow icon="checkmark.circle" label="قوالب مجانية" caption="داخل نافذة ٢٤ ساعة" value={spend.free} tone="success" />

      {spend.days.length ? (
        <>
          <RowDivider />
          <Text style={{ ...type.subheadStrong, ...rtlText, color: colors.textSecondary, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xs }}>
            حسب اليوم
          </Text>
          {spend.days.map((day) => (
            <View
              key={day.day}
              accessible
              accessibilityLabel={`${dayLabel.format(new Date(`${day.day}T00:00:00Z`))}، ${sarLabel(day.costSar)}`}
              style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.xs, gap: 3 }}
            >
              <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}>
                <Text style={{ ...type.footnote, ...numeric, ...rtlText, width: 92, color: colors.text }}>
                  {dayLabel.format(new Date(`${day.day}T00:00:00Z`))}
                </Text>
                <View style={{ flex: 1, height: 6, borderRadius: radius.full, backgroundColor: colors.surfaceSunken, flexDirection: "row-reverse" }}>
                  <View
                    style={{
                      width: `${maxDay ? Math.max(2, (day.costSar / maxDay) * 100) : 0}%`,
                      borderRadius: radius.full,
                      backgroundColor: colors.brand,
                    }}
                  />
                </View>
                <Text selectable style={{ ...type.footnote, ...numeric, minWidth: 74, textAlign: "left", color: colors.text, fontWeight: "700" }}>
                  {sarLabel(day.costSar)}
                </Text>
              </View>
              <Text selectable style={{ ...type.caption, ...numeric, ...rtlText, color: colors.textTertiary }}>
                {reportInteger.format(day.marketing)} تسويقية · {reportInteger.format(day.utility + day.authentication)} خدمية مدفوعة · {reportInteger.format(day.free)} مجانية
              </Text>
            </View>
          ))}
        </>
      ) : null}
    </ReportGroup>
  );
}
