import { Link } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { Card, Divider } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { IconSymbol, type IconName } from "@/components/ui/icon-symbol";
import { hitSize, numeric, radius, rtlText, spacing, type } from "@/constants/theme";
import { durationLabel, formatters } from "@/lib/format";
import { REPORT_LOCALE, reportInteger } from "@/lib/operations-report";
import { useTheme } from "@/providers/theme-provider";
import type { OrderOutcomeAudit, OrderProblem, OrderProblemKind, OrdersReport } from "@/types/api";

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

type MetricTone = "default" | "danger" | "warning" | "success";

function Metric({ icon, label, value, tone = "default" }: {
  icon: IconName;
  label: string;
  value: string;
  tone?: MetricTone;
}) {
  const { colors } = useTheme();
  const palette = {
    default: { background: colors.surface, foreground: colors.brand },
    danger: { background: colors.dangerSoft, foreground: colors.onDangerSoft },
    warning: { background: colors.warningSoft, foreground: colors.onWarningSoft },
    success: { background: colors.successSoft, foreground: colors.onSuccessSoft },
  }[tone];
  return (
    <View style={{
      flex: 1,
      minWidth: 105,
      gap: spacing.xs,
      padding: spacing.md,
      borderRadius: radius.lg,
      borderCurve: "continuous",
      backgroundColor: palette.background,
    }}>
      <IconSymbol name={icon} size={18} color={palette.foreground} />
      <Text style={{ ...type.caption, ...rtlText, color: colors.textSecondary }}>{label}</Text>
      <Text selectable style={{ ...type.title3, ...numeric, ...rtlText, color: colors.text }}>{value}</Text>
    </View>
  );
}

const PROBLEM_LABEL: Record<OrderProblemKind, (problem: OrderProblem) => string> = {
  late: (problem) => `تأخر بدء الخدمة ${durationLabel(problem.lateMinutes)}`,
  service_overrun: (problem) => `تجاوزت الخدمة وقتها بـ ${durationLabel(problem.overrunMinutes)}`,
  missing_trip_cost: () => "تكلفة المشوار غير مسجلة",
  not_done: () => "الخدمة لم يتم تنفيذها",
};

function ProblemRow({ problem }: { problem: OrderProblem }) {
  const { colors } = useTheme();
  return (
    <Link href={{ pathname: "/orders/[id]", params: { id: problem.orderId } }} asChild>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`مشكلة في طلب ${problem.customerName ?? problem.customerPhone}`}
        accessibilityHint="يفتح تفاصيل الطلب للمراجعة"
        style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
      >
        <View style={{ minHeight: hitSize.control, paddingVertical: spacing.md, gap: spacing.xs }}>
          <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}>
            <IconSymbol name="exclamationmark.triangle" size={18} color={colors.danger} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text selectable style={{ ...type.bodyStrong, ...rtlText, color: colors.text }}>
                {problem.customerName || problem.customerPhone}
              </Text>
              <Text selectable style={{ ...type.caption, ...numeric, ...rtlText, color: colors.textSecondary }}>
                {formatters.dateTime.format(new Date(problem.arrivalAt))}
                {problem.driverName ? ` · ${problem.driverName}` : ""}
              </Text>
            </View>
            <IconSymbol name="chevron.left" size={19} color={colors.textTertiary} />
          </View>
          <Text selectable style={{ ...type.footnote, ...rtlText, color: colors.onDangerSoft }}>
            {problem.kinds.map((kind) => PROBLEM_LABEL[kind](problem)).join(" · ")}
          </Text>
          {problem.actualServiceMinutes != null ? (
            <Text selectable style={{ ...type.caption, ...numeric, ...rtlText, color: colors.textTertiary }}>
              المحجوز {durationLabel(problem.bookedServiceMinutes)} · الفعلي {durationLabel(problem.actualServiceMinutes)}
            </Text>
          ) : null}
          {problem.completionNote ? (
            <Text selectable style={{ ...type.footnote, ...rtlText, color: colors.text }}>
              ملاحظة الفريق: {problem.completionNote}
            </Text>
          ) : null}
        </View>
      </Pressable>
    </Link>
  );
}

function OutcomeRow({ outcome }: { outcome: OrderOutcomeAudit }) {
  const { colors } = useTheme();
  const notDone = outcome.outcome === "not_done";
  return (
    <Link href={{ pathname: "/orders/[id]", params: { id: outcome.orderId } }} asChild>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`نتيجة طلب ${outcome.customerName ?? outcome.customerPhone}`}
        accessibilityHint="يفتح تفاصيل الطلب للمراجعة"
        style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
      >
        <View style={{ minHeight: hitSize.control, paddingVertical: spacing.md, gap: spacing.sm }}>
          <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text selectable style={{ ...type.bodyStrong, ...rtlText, color: colors.text }}>
                {outcome.customerName || outcome.customerPhone}
              </Text>
              <Text selectable style={{ ...type.caption, ...numeric, ...rtlText, color: colors.textSecondary }}>
                {formatters.dateTime.format(new Date(outcome.completedAt))}
                {outcome.specialistName ? ` · ${outcome.specialistName}` : ""}
              </Text>
            </View>
            <Badge
              label={notDone ? "لم يتم التنفيذ" : "تم التنفيذ"}
              tone={notDone ? "danger" : "success"}
              icon={notDone ? "xmark.circle" : "checkmark.circle"}
            />
          </View>
          <Text selectable style={{ ...type.footnote, ...rtlText, color: outcome.note ? colors.text : colors.textTertiary }}>
            {outcome.note || "لم تُضف ملاحظة"}
          </Text>
        </View>
      </Pressable>
    </Link>
  );
}

export function OrdersSummary({ report }: { report: OrdersReport }) {
  const { colors } = useTheme();
  const totals = report.totals;
  const problemOrders = totals.problemOrders ?? 0;
  const variance = totals.serviceVarianceMinutes ?? 0;

  return (
    <View style={{ gap: spacing.lg }}>
      <Card variant="raised" style={{
        backgroundColor: problemOrders ? colors.dangerSoft : colors.successSoft,
        borderColor: problemOrders ? colors.dangerSoft : colors.successSoft,
      }}>
        <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.md }}>
          <IconSymbol
            name={problemOrders ? "exclamationmark.triangle" : "checkmark.circle"}
            size={26}
            color={problemOrders ? colors.onDangerSoft : colors.onSuccessSoft}
          />
          <View style={{ flex: 1, gap: spacing.xs }}>
            <Text style={{ ...type.headline, ...rtlText, color: problemOrders ? colors.onDangerSoft : colors.onSuccessSoft }}>
              {problemOrders ? "طلبات تحتاج مراجعة" : "لا توجد مشاكل مسجلة"}
            </Text>
            <Text selectable style={{ ...type.title2, ...numeric, ...rtlText, color: problemOrders ? colors.onDangerSoft : colors.onSuccessSoft }}>
              {reportInteger.format(problemOrders)}
            </Text>
          </View>
        </View>
      </Card>

      <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: spacing.sm }}>
        <Metric icon="clock" label="بدء متأخر" value={reportInteger.format(totals.lateOrders ?? 0)} tone={(totals.lateOrders ?? 0) ? "danger" : "default"} />
        <Metric icon="exclamationmark.circle" label="تجاوز وقت الخدمة" value={reportInteger.format(totals.serviceOverruns ?? 0)} tone={(totals.serviceOverruns ?? 0) ? "warning" : "default"} />
        <Metric icon="banknote" label="تكلفة مشوار ناقصة" value={reportInteger.format(totals.missingTripCosts ?? 0)} tone={(totals.missingTripCosts ?? 0) ? "warning" : "default"} />
        <Metric icon="xmark.circle" label="لم يتم التنفيذ" value={reportInteger.format(totals.notDone ?? 0)} tone={(totals.notDone ?? 0) ? "danger" : "default"} />
      </View>

      {(report.problems ?? []).length ? (
        <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
          <View style={{ paddingVertical: spacing.lg, gap: spacing.xs }}>
            <Text style={{ ...type.headline, ...rtlText, color: colors.text }}>المشاكل حسب الطلب</Text>
            <Text style={{ ...type.footnote, ...rtlText, color: colors.textSecondary }}>
              افتحي الطلب لتراجعي التنفيذ أو تسجلي تكلفة المشوار.
            </Text>
          </View>
          {(report.problems ?? []).map((problem, index) => (
            <View key={problem.orderId}>
              {index ? <Divider /> : null}
              <ProblemRow problem={problem} />
            </View>
          ))}
        </Card>
      ) : null}

      {(report.outcomes ?? []).length ? (
        <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
          <View style={{ paddingVertical: spacing.lg, gap: spacing.xs }}>
            <Text style={{ ...type.headline, ...rtlText, color: colors.text }}>
              نتائج وملاحظات التنفيذ
            </Text>
            <Text style={{ ...type.footnote, ...rtlText, color: colors.textSecondary }}>
              كل نتيجة سجلها الفريق عند إنهاء الخدمة، سواء تم التنفيذ أو لم يتم.
            </Text>
          </View>
          {(report.outcomes ?? []).map((outcome, index) => (
            <View key={outcome.orderId}>
              {index ? <Divider /> : null}
              <OutcomeRow outcome={outcome} />
            </View>
          ))}
        </Card>
      ) : null}

      <Card>
        <View style={{ gap: spacing.xs }}>
          <Text style={{ ...type.headline, ...rtlText, color: colors.text }}>وقت الخدمة: المحجوز مقابل الفعلي</Text>
          <Text style={{ ...type.footnote, ...rtlText, color: colors.textSecondary }}>
            يعتمد الوقت الفعلي على تسجيل بدء الخدمة وإنهائها داخل تطبيق الفريق.
          </Text>
        </View>
        <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: spacing.sm }}>
          <Metric icon="calendar" label="الوقت المحجوز" value={durationLabel(totals.bookedServiceMinutes ?? 0)} />
          <Metric icon="clock" label="الوقت الفعلي" value={durationLabel(totals.actualServiceMinutes ?? 0)} />
          <Metric
            icon={variance > 0 ? "arrow.up" : "checkmark.circle"}
            label="الفرق"
            value={`${variance > 0 ? "+" : variance < 0 ? "−" : ""}${durationLabel(Math.abs(variance))}`}
            tone={variance > 15 ? "warning" : "success"}
          />
        </View>
        <Text selectable style={{ ...type.caption, ...numeric, ...rtlText, color: colors.textTertiary }}>
          محسوب من {reportInteger.format(totals.timedOrders ?? 0)} طلب مكتمل بتوقيت مسجل.
        </Text>
      </Card>

      <Card>
        <View style={{ gap: spacing.xs }}>
          <Text style={{ ...type.headline, ...rtlText, color: colors.text }}>مستحقات السائقين</Text>
          <Text style={{ ...type.footnote, ...rtlText, color: colors.textSecondary }}>
            مجموع تكاليف المشاوير التي سجلتها حنان لكل سائق خلال الفترة.
          </Text>
        </View>
        {(report.driverSettlements ?? []).length ? (
          (report.driverSettlements ?? []).map((driver, index) => (
            <View key={driver.driverId}>
              {index ? <Divider /> : null}
              <View style={{ minHeight: hitSize.control, paddingVertical: spacing.md, gap: spacing.xs }}>
                <View style={{ flexDirection: "row-reverse", justifyContent: "space-between", gap: spacing.md }}>
                  <Text selectable style={{ ...type.bodyStrong, ...rtlText, color: colors.text }}>{driver.driverName}</Text>
                  <Text selectable style={{ ...type.bodyStrong, ...numeric, color: colors.brand }}>{currency.format(driver.totalTripCost)}</Text>
                </View>
                <Text selectable style={{ ...type.caption, ...numeric, ...rtlText, color: colors.textSecondary }}>
                  {reportInteger.format(driver.orders)} مشوار · {reportInteger.format(driver.recordedCosts)} مسجل
                  {driver.missingCosts ? ` · ${reportInteger.format(driver.missingCosts)} بدون تكلفة` : ""}
                </Text>
              </View>
            </View>
          ))
        ) : (
          <Text style={{ ...type.body, ...rtlText, color: colors.textSecondary }}>لا توجد مشاوير مسندة خلال الفترة المختارة.</Text>
        )}
      </Card>

      <Card variant="raised">
        <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.md }}>
          <IconSymbol name="banknote" size={24} color={colors.success} />
          <View style={{ flex: 1, gap: spacing.xs }}>
            <Text style={{ ...type.caption, ...rtlText, color: colors.textSecondary }}>صافي الخدمات بعد تكلفة المشاوير</Text>
            <Text selectable style={{ ...type.title2, ...numeric, ...rtlText, color: colors.text }}>
              {currency.format(totals.netAfterTripCosts ?? totals.serviceRevenue)}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: spacing.sm }}>
          <Metric icon="sparkles" label="إيراد الخدمات" value={currency.format(totals.serviceRevenue)} />
          <Metric icon="car" label="تكلفة المشاوير" value={currency.format(totals.tripCosts ?? 0)} tone="warning" />
          <Metric icon="arrow.triangle.2.circlepath" label="المبالغ المستردة" value={currency.format(totals.refunded)} />
        </View>
      </Card>

      <Card>
        <View style={{ gap: spacing.xs }}>
          <Text style={{ ...type.headline, ...rtlText, color: colors.text }}>ملخص التنفيذ</Text>
          <Text style={{ ...type.footnote, ...rtlText, color: colors.textSecondary }}>كل طلب متعدد الخدمات يُحسب مرة واحدة.</Text>
        </View>
        <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: spacing.sm }}>
          <Metric icon="doc.text" label="إجمالي الطلبات" value={reportInteger.format(totals.total)} />
          <Metric icon="checkmark.circle" label="مكتملة" value={reportInteger.format(totals.completed)} />
          <Metric icon="xmark.circle" label="لم يتم التنفيذ" value={reportInteger.format(totals.notDone ?? 0)} tone={(totals.notDone ?? 0) ? "danger" : "default"} />
          <Metric icon="clock" label="جارية أو قادمة" value={reportInteger.format(totals.active)} />
          <Metric icon="xmark" label="ملغاة" value={reportInteger.format(totals.cancelled)} />
          <Metric icon="slider.horizontal.3" label="نسبة الإكمال" value={`${reportInteger.format(totals.completionRate)}%`} />
        </View>
      </Card>

      <Card>
        <View style={{ gap: spacing.xs }}>
          <Text style={{ ...type.headline, ...rtlText, color: colors.text }}>التفصيل حسب اليوم</Text>
          <Text style={{ ...type.footnote, ...rtlText, color: colors.textSecondary }}>الإيراد الظاهر للخدمات بعد الاسترداد، ولا يشمل تكلفة السائق.</Text>
        </View>
        {report.daily.length ? report.daily.map((day) => (
          <View key={day.day} style={{ gap: spacing.xs, paddingVertical: spacing.sm }}>
            <View style={{ flexDirection: "row-reverse", justifyContent: "space-between", gap: spacing.md }}>
              <Text selectable style={{ ...type.subheadStrong, ...numeric, ...rtlText, color: colors.text }}>
                {dayLabel.format(new Date(`${day.day}T12:00:00+03:00`))}
              </Text>
              <Text selectable style={{ ...type.subheadStrong, ...numeric, color: colors.success }}>{currency.format(day.revenue)}</Text>
            </View>
            <Text selectable style={{ ...type.caption, ...numeric, ...rtlText, color: colors.textSecondary }}>
              {reportInteger.format(day.total)} طلب · {reportInteger.format(day.completed)} مكتمل · {reportInteger.format(day.notDone ?? 0)} لم يتم · {reportInteger.format(day.active)} نشط · {reportInteger.format(day.cancelled)} ملغى
            </Text>
          </View>
        )) : (
          <Text style={{ ...type.body, ...rtlText, color: colors.textSecondary }}>لا توجد طلبات خلال الفترة المختارة.</Text>
        )}
      </Card>
    </View>
  );
}
