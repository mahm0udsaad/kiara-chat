import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/ui/card";
import { IconSymbol, type IconName } from "@/components/ui/icon-symbol";
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

function Metric({
  icon,
  label,
  value,
}: {
  icon: IconName;
  label: string;
  /** A pre-formatted string passes through — durations are not plain counts. */
  value: number | string;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flex: 1,
        minWidth: 96,
        gap: spacing.xs,
        padding: spacing.md,
        borderRadius: radius.lg,
        backgroundColor: colors.surface,
      }}
    >
      <IconSymbol name={icon} size={18} color={colors.brand} />
      <Text style={{ ...type.caption, ...rtlText, color: colors.textTertiary }}>{label}</Text>
      <Text selectable style={{ ...type.title3, ...numeric, ...rtlText, color: colors.text }}>
        {typeof value === "number" ? reportInteger.format(value) : value}
      </Text>
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
            {/* Five plain counts, no averages and no rates: the owner reads
                this list to run a shift, and every figure here is something
                she can act on without doing arithmetic first. */}
            <View
              style={{
                flexDirection: "row-reverse",
                flexWrap: "wrap",
                columnGap: spacing.md,
                rowGap: 2,
              }}
            >
              <Figure
                label="في التطبيق"
                value={employee.activeMinutes ? durationLabel(employee.activeMinutes) : "—"}
              />
              <Figure label="محادثة" value={reportInteger.format(employee.handledConversations)} />
              <Figure
                label="حجز في ركاز"
                value={reportInteger.format(employee.rekazBookings ?? 0)}
                highlight
              />
              <Figure
                label="ر.س"
                value={employee.bookedRevenue ? reportInteger.format(employee.bookedRevenue) : "—"}
                highlight
              />
              <Figure label="مسندة الآن" value={reportInteger.format(employee.currentAssigned)} />
            </View>
            <Text selectable style={{ ...type.caption, ...numeric, ...rtlText, color: colors.textTertiary }}>
              {lastActivity ? `آخر نشاط ${relativeTimeLabel(lastActivity)}` : "لا يوجد نشاط مسجل"}
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
  return (
    <View style={{ gap: spacing.lg }}>
      {outcomes ? (
        <Card>
          <View style={{ gap: spacing.xs }}>
            <Text style={{ ...type.headline, ...rtlText, color: colors.text }}>
              نتائج آخر ٢٤ ساعة
            </Text>
            <Text style={{ ...type.footnote, ...rtlText, color: colors.textSecondary }}>
              نتيجة منفصلة لكل محادثة واردة، ولا تتأثر بإطلاق المحادثة أو نقلها.
            </Text>
          </View>
          <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: spacing.sm }}>
            <Metric icon="message" label="رسائل واردة" value={outcomes.inboundMessages} />
            <Metric icon="person.2" label="محادثات واردة" value={outcomes.inboundConversations} />
            <Metric icon="checkmark.circle" label="حجوزات مؤكدة" value={outcomes.booked} />
            <Metric icon="exclamationmark.circle" label="لم يتم الحجز" value={outcomes.notBooked} />
            <Metric icon="phone" label="لم ترد" value={outcomes.noReply} />
            <Metric icon="clock" label="بانتظار النتيجة" value={outcomes.awaitingOutcome} />
          </View>
        </Card>
      ) : null}

      <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: spacing.sm }}>
        <Metric icon="checkmark.circle" label="نشطات الآن" value={report.totals.activeNow} />
        <Metric
          icon="clock"
          label="وقت الفريق بالتطبيق"
          value={report.totals.activeMinutes ? durationLabel(report.totals.activeMinutes) : "—"}
        />
        <Metric icon="message" label="محادثات" value={report.totals.handledConversations} />
        <Metric icon="calendar" label="حجوزات ركاز" value={report.totals.rekazBookings ?? 0} />
        <Metric
          icon="banknote"
          label="قيمة الحجوزات"
          value={report.totals.bookedRevenue ? reportInteger.format(report.totals.bookedRevenue) : "—"}
        />
        <Metric icon="tray" label="مسند الآن" value={report.totals.currentAssigned} />
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
