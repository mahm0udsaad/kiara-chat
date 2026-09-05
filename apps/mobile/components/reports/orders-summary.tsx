import { Text, View } from "react-native";

import { Card } from "@/components/ui/card";
import { IconSymbol, type IconName } from "@/components/ui/icon-symbol";
import { numeric, radius, rtlText, spacing, type } from "@/constants/theme";
import { REPORT_LOCALE, reportInteger } from "@/lib/operations-report";
import { useTheme } from "@/providers/theme-provider";
import type { OrdersReport } from "@/types/api";

const currency = new Intl.NumberFormat(REPORT_LOCALE, {
  style: "currency",
  currency: "SAR",
  maximumFractionDigits: 2,
});
const dayLabel = new Intl.DateTimeFormat(REPORT_LOCALE, {
  weekday: "short",
  day: "numeric",
  month: "short",
});

function Metric({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, minWidth: 105, gap: spacing.xs, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface }}>
      <IconSymbol name={icon} size={18} color={colors.brand} />
      <Text style={{ ...type.caption, ...rtlText, color: colors.textTertiary }}>{label}</Text>
      <Text selectable style={{ ...type.title3, ...numeric, ...rtlText, color: colors.text }}>{value}</Text>
    </View>
  );
}

export function OrdersSummary({ report }: { report: OrdersReport }) {
  const { colors } = useTheme();
  const totals = report.totals;
  return (
    <View style={{ gap: spacing.lg }}>
      <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: spacing.sm }}>
        <Metric icon="doc.text" label="إجمالي الطلبات" value={reportInteger.format(totals.total)} />
        <Metric icon="checkmark.circle" label="مكتملة" value={reportInteger.format(totals.completed)} />
        <Metric icon="sparkles" label="منتهية في ركاز" value={reportInteger.format(totals.rekazDone)} />
        <Metric icon="figure.walk" label="اكتملت ميدانياً" value={reportInteger.format(totals.fieldCompleted)} />
        <Metric icon="clock" label="جارية أو قادمة" value={reportInteger.format(totals.active)} />
        <Metric icon="xmark" label="ملغاة" value={reportInteger.format(totals.cancelled)} />
        <Metric icon="pencil" label="تم تعديلها" value={reportInteger.format(totals.edited)} />
        <Metric icon="car" label="أُرسلت للفريق" value={reportInteger.format(totals.dispatched)} />
        <Metric icon="slider.horizontal.3" label="نسبة الإكمال" value={`${reportInteger.format(totals.completionRate)}%`} />
      </View>

      <Card variant="raised">
        <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.md }}>
          <IconSymbol name="banknote" size={24} color={colors.success} />
          <View style={{ flex: 1, gap: spacing.xs }}>
            <Text style={{ ...type.caption, ...rtlText, color: colors.textSecondary }}>إجمالي الإيراد الصافي</Text>
            <Text selectable style={{ ...type.title2, ...numeric, ...rtlText, color: colors.text }}>
              {currency.format(totals.totalRevenue)}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: spacing.sm }}>
          <Metric icon="sparkles" label="إيراد الخدمات" value={currency.format(totals.serviceRevenue)} />
          <Metric icon="car" label="إيراد التوصيل" value={currency.format(totals.transportRevenue)} />
          <Metric icon="arrow.triangle.2.circlepath" label="المبالغ المستردة" value={currency.format(totals.refunded)} />
        </View>
        <Text style={{ ...type.caption, ...rtlText, color: colors.textTertiary }}>
          إيراد الخدمات من إجمالي طلب ركاز بعد الاسترداد، وإيراد التوصيل من سعر مشوار التطبيق.
        </Text>
      </Card>

      <Card>
        <View style={{ gap: spacing.xs }}>
          <Text style={{ ...type.headline, ...rtlText, color: colors.text }}>التفصيل حسب اليوم</Text>
          <Text style={{ ...type.footnote, ...rtlText, color: colors.textSecondary }}>كل طلب متعدد الخدمات يُحسب مرة واحدة.</Text>
        </View>
        {report.daily.length ? report.daily.map((day) => (
          <View key={day.day} style={{ gap: spacing.xs, paddingVertical: spacing.sm }}>
            <View style={{ flexDirection: "row-reverse", justifyContent: "space-between", gap: spacing.md }}>
              <Text selectable style={{ ...type.subheadStrong, ...numeric, ...rtlText, color: colors.text }}>
                {dayLabel.format(new Date(`${day.day}T12:00:00+03:00`))}
              </Text>
              <Text selectable style={{ ...type.subheadStrong, ...numeric, color: colors.success }}>
                {currency.format(day.revenue)}
              </Text>
            </View>
            <Text selectable style={{ ...type.caption, ...numeric, ...rtlText, color: colors.textSecondary }}>
              {reportInteger.format(day.total)} طلب · {reportInteger.format(day.completed)} مكتمل · {reportInteger.format(day.active)} نشط · {reportInteger.format(day.edited)} معدل · {reportInteger.format(day.cancelled)} ملغى
            </Text>
          </View>
        )) : (
          <Text style={{ ...type.body, ...rtlText, color: colors.textSecondary }}>لا توجد طلبات خلال الفترة المختارة.</Text>
        )}
      </Card>
    </View>
  );
}
