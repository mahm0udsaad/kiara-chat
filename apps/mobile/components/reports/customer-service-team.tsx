import { Link, type Href } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { MetaSpendCard, sarLabel } from "@/components/reports/meta-spend-card";
import {
  FigureStrip,
  ReportGroup,
  ReportRow,
  RowDivider,
  ShareBar,
} from "@/components/reports/report-rows";
import { Card } from "@/components/ui/card";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { hitSize, numeric, radius, rtlText, spacing, type } from "@/constants/theme";
import { dayKeyFromToday } from "@/lib/calendar";
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
  // An older server only has the rolling 24 hours; a current one counts the
  // customers of whatever days the owner picked.
  const usesPeriod = Boolean(report.period);
  const outcomes = report.period ?? report.last24Hours;
  const isToday = report.from === report.to && report.to === dayKeyFromToday(0);
  const metricHref = (metric: string, scope?: "period") => ({
    pathname: "/reports/customer-service/team/[metric]",
    params: {
      metric,
      ...(scope ? { scope } : {}),
      from: report.from,
      to: report.to,
      startTime: report.startTime,
      endTime: report.endTime,
    },
  } as unknown as Href);
  const scope = usesPeriod ? "period" as const : undefined;
  const notBookedTotal = outcomes ? Math.max(0, outcomes.inboundConversations - outcomes.booked) : 0;
  return (
    <View style={{ gap: spacing.lg }}>
      {outcomes ? (
        <ReportGroup
          title={usesPeriod ? (isToday ? "عملاء اليوم" : "عملاء الفترة") : "نتائج آخر ٢٤ ساعة"}
          description="الحجز من ركاز برقم العميلة أو من نتيجة المحادثة."
        >
          <FigureStrip
            figures={[
              { label: "تواصلن", value: outcomes.inboundConversations, tone: "brand", href: metricHref("inbound-conversations", scope), testID: "customer-service-team-inbound-conversations" },
              { label: "حجزن", value: outcomes.booked, tone: "success", href: metricHref("booked", scope), testID: "customer-service-team-booked" },
              { label: "لم يحجزن", value: notBookedTotal, tone: notBookedTotal ? "danger" : "neutral", href: metricHref("not-booked-total", scope), testID: "customer-service-team-not-booked-total" },
            ]}
          />
          <ShareBar
            segments={[
              { value: outcomes.booked, tone: "success" },
              { value: notBookedTotal, tone: "danger" },
            ]}
          />
          {usesPeriod && report.customerTypes ? (
            <>
              <RowDivider />
              <ReportRow icon="sparkles" label="عميلات جديدات" caption="لا حجز لهن في ركاز قبل أول رسالة" value={report.customerTypes.new} tone="brand" href={metricHref("new-customers", scope)} testID="customer-service-team-new-customers" />
              <RowDivider />
              <ReportRow
                icon="calendar"
                label="عميلات سابقات"
                caption={report.customerTypes.unknown
                  ? `لهن حجز سابق في ركاز · تعذّر سؤال ركاز عن ${reportInteger.format(report.customerTypes.unknown)}`
                  : "لهن حجز سابق في ركاز"}
                value={report.customerTypes.returning}
                href={metricHref("returning-customers", scope)}
                testID="customer-service-team-returning-customers"
              />
            </>
          ) : null}
          <RowDivider />
          <ReportRow icon="clock" label="بلا نتيجة مسجلة" value={outcomes.awaitingOutcome} tone={outcomes.awaitingOutcome ? "info" : "neutral"} href={metricHref("awaiting-outcome", scope)} testID="customer-service-team-awaiting-outcome" />
          <RowDivider />
          <ReportRow icon="phone" label="لم ترد" value={outcomes.noReply} href={metricHref("no-reply", scope)} testID="customer-service-team-no-reply" />
          <RowDivider />
          <ReportRow icon="xmark.circle" label="سُجلت «لم يتم الحجز»" value={outcomes.notBooked} href={metricHref("not-booked", scope)} testID="customer-service-team-not-booked" />
        </ReportGroup>
      ) : null}

      {report.closed ? (
        <ReportGroup title="المحادثات المنتهية" description="ما أُغلق خلال الفترة، وهل انتهى بحجز.">
          <FigureStrip
            figures={[
              { label: "انتهت", value: report.closed.total, tone: "brand", href: metricHref("closed", "period"), testID: "customer-service-team-closed" },
              { label: "بحجز", value: report.closed.booked, tone: "success", href: metricHref("closed-booked", "period"), testID: "customer-service-team-closed-booked" },
              { label: "دون حجز", value: report.closed.notBooked, tone: report.closed.notBooked ? "danger" : "neutral", href: metricHref("closed-not-booked", "period"), testID: "customer-service-team-closed-not-booked" },
            ]}
          />
          <ShareBar
            segments={[
              { value: report.closed.booked, tone: "success" },
              { value: report.closed.notBooked, tone: "danger" },
            ]}
          />
        </ReportGroup>
      ) : null}

      {outcomes ? (
        <ReportGroup title="الرسائل">
          {report.outbound ? (
            <>
              <FigureStrip
                figures={[
                  { label: "أُرسلت من التطبيق", value: report.outbound.total, tone: "brand", href: metricHref("messages-sent"), testID: "customer-service-team-messages-sent" },
                  { label: "واردة", value: outcomes.inboundMessages, href: metricHref("inbound-messages", scope), testID: "customer-service-team-inbound-messages" },
                ]}
              />
              <RowDivider />
              <ReportRow icon="person.2" label="من الفريق" value={report.outbound.team} href={metricHref("messages-sent")} testID="customer-service-team-messages-team" />
              <RowDivider />
              <ReportRow icon="sparkles" label="آلية" caption="البوت والتذكيرات والحملات" value={report.outbound.automated} />
            </>
          ) : (
            <ReportRow icon="message" label="رسائل واردة" value={outcomes.inboundMessages} href={metricHref("inbound-messages", scope)} testID="customer-service-team-inbound-messages" />
          )}
        </ReportGroup>
      ) : null}

      {report.metaSpend ? <MetaSpendCard spend={report.metaSpend} /> : null}

      <ReportGroup title="أداء الفريق" description="ضمن الفترة المختارة.">
        <ReportRow icon="checkmark.circle" label="نشطات الآن" value={report.totals.activeNow} tone={report.totals.activeNow ? "success" : "neutral"} href={metricHref("active-now")} testID="customer-service-team-active-now" />
        <RowDivider />
        <ReportRow icon="clock" label="وقت الفريق في المحادثات" value={report.totals.chatMinutes ? durationLabel(report.totals.chatMinutes) : "—"} href={metricHref("time")} testID="customer-service-team-time" />
        <RowDivider />
        <ReportRow icon="message" label="محادثات تعامل معها الفريق" value={report.totals.handledConversations} href={metricHref("conversations")} testID="customer-service-team-conversations" />
        <RowDivider />
        <ReportRow icon="calendar" label="حجوزات أدخلها الفريق في ركاز" value={report.totals.rekazBookings ?? 0} href={metricHref("bookings")} testID="customer-service-team-bookings" />
        <RowDivider />
        <ReportRow icon="banknote" label="قيمة الحجوزات" value={report.totals.bookedRevenue ? sarLabel(report.totals.bookedRevenue) : "—"} href={metricHref("revenue")} testID="customer-service-team-revenue" />
        <RowDivider />
        <ReportRow icon="tray" label="مسندة الآن" value={report.totals.currentAssigned} href={metricHref("assigned")} testID="customer-service-team-assigned" />
      </ReportGroup>

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
