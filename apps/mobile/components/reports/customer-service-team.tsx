import { Link, type Href } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  ReportMetricCard,
  ReportMetricGrid,
  ReportSectionHeader,
} from "@/components/reports/report-metric-card";
import { Card } from "@/components/ui/card";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { hitSize, numeric, radius, rtlText, spacing, type } from "@/constants/theme";
import { durationLabel, relativeTimeLabel } from "@/lib/format";
import { reportInteger } from "@/lib/operations-report";
import { useTheme } from "@/providers/theme-provider";
import type { CustomerServiceEmployee, CustomerServiceReport } from "@/types/api";

/**
 * One number and what it counts, side by side.
 *
 * Deliberately plainer than `Metric`: a row of these has to be read at a
 * glance while standing up, so no icons, no tiles, and nothing derived — the
 * owner asked for counts she can act on, not rates she has to interpret.
 */
function Figure({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  /** Booking figures carry the outcome, so they take the accent. */
  highlight?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row-reverse", alignItems: "baseline", gap: 4 }}>
      <Text
        selectable
        style={{
          ...type.bodyStrong,
          ...numeric,
          color: highlight ? colors.brand : colors.text,
        }}
      >
        {value}
      </Text>
      <Text style={{ ...type.caption, color: colors.textTertiary }}>{label}</Text>
    </View>
  );
}

function EmployeeRow({
  employee,
  range,
}: {
  employee: CustomerServiceEmployee;
  range: Pick<CustomerServiceReport, "from" | "to" | "startTime" | "endTime">;
}) {
  const { colors } = useTheme();
  const lastActivity = employee.lastActionAt ?? employee.lastSeenAt;
  return (
    <Link
      href={{
        pathname: "/reports/customer-service/[personId]",
        params: {
          personId: employee.teamMemberId,
          name: employee.name,
          ...range,
        },
      }}
      asChild
    >
      <Pressable
        testID={`customer-service-person-${employee.teamMemberId}`}
        accessibilityRole="button"
        accessibilityLabel={`تقرير ${employee.name}، ${employee.activeNow ? "نشطة الآن" : "غير نشطة الآن"}`}
        accessibilityHint="يفتح تفاصيل المحادثات والردود والإجراءات"
        style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
      >
        <View
          style={{
            minHeight: hitSize.control,
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.md,
            flexDirection: "row-reverse",
            alignItems: "center",
            gap: spacing.md,
            backgroundColor: colors.surface,
          }}
        >
          <View style={{ flex: 1, gap: spacing.xs }}>
            <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}>
              <Text selectable style={{ ...type.bodyStrong, ...rtlText, color: colors.text }}>
                {employee.name}
              </Text>
              <View
                style={{
                  flexDirection: "row-reverse",
                  alignItems: "center",
                  gap: spacing.xs,
                  paddingHorizontal: spacing.sm,
                  paddingVertical: 2,
                  borderRadius: radius.full,
                  backgroundColor: employee.activeNow ? colors.successSoft : colors.surfaceSunken,
                }}
              >
                <View
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: radius.full,
                    backgroundColor: employee.activeNow ? colors.success : colors.textTertiary,
                  }}
                />
                <Text
                  style={{
                    ...type.caption,
                    color: employee.activeNow ? colors.onSuccessSoft : colors.textTertiary,
                  }}
                >
                  {employee.activeNow ? "نشطة الآن" : "غير نشطة"}
                </Text>
              </View>
            </View>
            {/* Keep the row scannable. The less-frequent revenue and time
                breakdowns remain available from the metric cards above. */}
            <View
              style={{
                flexDirection: "row-reverse",
                flexWrap: "wrap",
                columnGap: spacing.md,
                rowGap: 2,
              }}
            >
              <Figure label="محادثة" value={reportInteger.format(employee.handledConversations)} />
              <Figure
                label="حجز في ركاز"
                value={reportInteger.format(employee.rekazBookings ?? 0)}
                highlight
              />
              <Figure label="مسندة الآن" value={reportInteger.format(employee.currentAssigned)} />
            </View>
            <Text selectable style={{ ...type.caption, ...numeric, ...rtlText, color: colors.textTertiary }}>
              {lastActivity ? `آخر نشاط ${relativeTimeLabel(lastActivity)}` : "لا يوجد نشاط مسجل"}
              {employee.chatMinutes ? ` · في المحادثات ${durationLabel(employee.chatMinutes)}` : ""}
            </Text>
          </View>
          <IconSymbol name="chevron.left" size={20} color={colors.textTertiary} />
        </View>
      </Pressable>
    </Link>
  );
}

export function CustomerServiceTeam({ report }: { report: CustomerServiceReport }) {
  const { colors } = useTheme();
  const outcomes = report.last24Hours;
  const metricHref = (metric: string) => ({
    pathname: "/reports/customer-service/team/[metric]",
    params: {
      metric,
      from: report.from,
      to: report.to,
      startTime: report.startTime,
      endTime: report.endTime,
    },
  } as unknown as Href);
  return (
    <View style={{ gap: spacing.lg }}>
      {outcomes ? (
        <View style={{ gap: spacing.md }}>
          <ReportSectionHeader
            title="نتائج آخر ٢٤ ساعة"
            description="اضغطي على أي نتيجة لعرض المحادثات المرتبطة بها."
          />
          <ReportMetricGrid>
            <ReportMetricCard tone="brand" icon="message" label="رسائل واردة" value={outcomes.inboundMessages} href={metricHref("inbound-messages")} testID="customer-service-team-inbound-messages" />
            <ReportMetricCard tone="brand" icon="person.2" label="محادثات واردة" value={outcomes.inboundConversations} href={metricHref("inbound-conversations")} testID="customer-service-team-inbound-conversations" />
            <ReportMetricCard tone="success" icon="checkmark.circle" label="حجوزات مؤكدة" value={outcomes.booked} href={metricHref("booked")} testID="customer-service-team-booked" />
            <ReportMetricCard tone="danger" icon="exclamationmark.circle" label="لم يتم الحجز" value={outcomes.notBooked} href={metricHref("not-booked")} testID="customer-service-team-not-booked" />
            <ReportMetricCard tone="warning" icon="phone" label="لم ترد" value={outcomes.noReply} href={metricHref("no-reply")} testID="customer-service-team-no-reply" />
            <ReportMetricCard tone="info" icon="clock" label="بانتظار النتيجة" value={outcomes.awaitingOutcome} href={metricHref("awaiting-outcome")} testID="customer-service-team-awaiting-outcome" />
          </ReportMetricGrid>
        </View>
      ) : null}

      <View style={{ gap: spacing.md }}>
        <ReportSectionHeader title="أداء الفترة" description="ملخص الفريق خلال الفترة المختارة." />
        <ReportMetricGrid>
          <ReportMetricCard icon="checkmark.circle" label="نشطات الآن" value={report.totals.activeNow} href={metricHref("active-now")} testID="customer-service-team-active-now" />
          <ReportMetricCard icon="clock" label="وقت الفريق في المحادثات" value={report.totals.chatMinutes ? durationLabel(report.totals.chatMinutes) : "—"} href={metricHref("time")} testID="customer-service-team-time" />
          <ReportMetricCard icon="message" label="محادثات" value={report.totals.handledConversations} href={metricHref("conversations")} testID="customer-service-team-conversations" />
          <ReportMetricCard icon="calendar" label="حجوزات ركاز" value={report.totals.rekazBookings ?? 0} href={metricHref("bookings")} testID="customer-service-team-bookings" />
          <ReportMetricCard icon="banknote" label="قيمة الحجوزات" value={report.totals.bookedRevenue ? reportInteger.format(report.totals.bookedRevenue) : "—"} href={metricHref("revenue")} testID="customer-service-team-revenue" />
          <ReportMetricCard icon="tray" label="مسند الآن" value={report.totals.currentAssigned} href={metricHref("assigned")} testID="customer-service-team-assigned" />
        </ReportMetricGrid>
      </View>

      <Card padded={false}>
        <View style={{ padding: spacing.lg, gap: spacing.xs }}>
          <Text style={{ ...type.headline, ...rtlText, color: colors.text }}>فريق خدمة العملاء</Text>
          <Text style={{ ...type.footnote, ...rtlText, color: colors.textSecondary }}>
            النشاط الآن يعتمد على نبضة مشفّرة من التطبيق، والأرقام أدناه ضمن الفترة المختارة فقط.
          </Text>
        </View>
        {report.employees.map((employee, index) => (
          <View key={employee.teamMemberId}>
            {index ? (
              <View
                style={{
                  height: StyleSheet.hairlineWidth,
                  marginHorizontal: spacing.lg,
                  backgroundColor: colors.border,
                }}
              />
            ) : null}
            <EmployeeRow
              employee={employee}
              range={{
                from: report.from,
                to: report.to,
                startTime: report.startTime,
                endTime: report.endTime,
              }}
            />
          </View>
        ))}
        {!report.employees.length ? (
          <Text style={{ padding: spacing.lg, ...type.body, ...rtlText, color: colors.textSecondary }}>
            لا يوجد موظفو خدمة عملاء مسجلون.
          </Text>
        ) : null}
      </Card>
    </View>
  );
}
