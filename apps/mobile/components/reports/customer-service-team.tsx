import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/ui/card";
import { IconSymbol, type IconName } from "@/components/ui/icon-symbol";
import { hitSize, numeric, radius, rtlText, spacing, type } from "@/constants/theme";
import { relativeTimeLabel } from "@/lib/format";
import { reportInteger } from "@/lib/operations-report";
import { useTheme } from "@/providers/theme-provider";
import type { CustomerServiceEmployee, CustomerServiceReport } from "@/types/api";

function Metric({ icon, label, value }: { icon: IconName; label: string; value: number }) {
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
        {reportInteger.format(value)}
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
            <Text selectable style={{ ...type.footnote, ...numeric, ...rtlText, color: colors.textSecondary }}>
              {reportInteger.format(employee.handledConversations)} محادثة · {reportInteger.format(employee.messagesSent)} رد · {reportInteger.format(employee.actions)} إجراء
            </Text>
            <Text selectable style={{ ...type.caption, ...numeric, ...rtlText, color: colors.textTertiary }}>
              {reportInteger.format(employee.currentAssigned)} مسندة الآن
              {lastActivity ? ` · آخر نشاط ${relativeTimeLabel(lastActivity)}` : " · لا يوجد نشاط مسجل"}
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
  return (
    <View style={{ gap: spacing.lg }}>
      <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: spacing.sm }}>
        <Metric icon="person.2" label="الموظفات" value={report.totals.employees} />
        <Metric icon="checkmark.circle" label="نشطات الآن" value={report.totals.activeNow} />
        <Metric icon="message" label="محادثات" value={report.totals.handledConversations} />
        <Metric icon="paperplane.fill" label="ردود" value={report.totals.messagesSent} />
        <Metric icon="pencil" label="إجراءات" value={report.totals.actions} />
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
