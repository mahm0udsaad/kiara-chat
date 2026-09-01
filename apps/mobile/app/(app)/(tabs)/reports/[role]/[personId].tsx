import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { useState } from "react";

import { ErrorState } from "@/components/screen-state";
import { VisitCard } from "@/components/reports/visit-card";
import { Card } from "@/components/ui/card";
import { IconSymbol, type IconName } from "@/components/ui/icon-symbol";
import { Segmented, type SegmentOption } from "@/components/ui/segmented";
import { numeric, radius, rtlText, spacing, type } from "@/constants/theme";
import { dayKeyFromToday } from "@/lib/calendar";
import {
  completedWorkLabel,
  groupOperationsVisits,
  REPORT_LOCALE,
  reportDecimal,
  reportInteger,
  reportRange,
  visitsByDay,
  type ReportPeriod,
} from "@/lib/operations-report";
import { useBootstrap, useOperationsReport } from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";
import type { OperationsRole } from "@/types/api";

const periodOptions: SegmentOption<ReportPeriod>[] = [
  { value: "month", label: "هذا الشهر" },
  { value: "week", label: "هذا الأسبوع" },
];
const rangeLabel = new Intl.DateTimeFormat(REPORT_LOCALE, { day: "numeric", month: "short", year: "numeric" });
const dayLabel = new Intl.DateTimeFormat(REPORT_LOCALE, {
  timeZone: "Asia/Riyadh",
  weekday: "long",
  day: "numeric",
  month: "long",
});

function Metric({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flex: 1,
        minWidth: 130,
        padding: spacing.md,
        gap: spacing.xs,
        borderRadius: radius.lg,
        backgroundColor: colors.surface,
      }}
    >
      <IconSymbol name={icon} size={18} color={colors.brand} />
      <Text style={{ ...type.caption, ...rtlText, color: colors.textTertiary }}>{label}</Text>
      <Text selectable style={{ ...type.title3, ...numeric, ...rtlText, color: colors.text }}>{value}</Text>
    </View>
  );
}

function asOne(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default function EmployeeReportScreen() {
  const params = useLocalSearchParams<{ role?: string | string[]; personId?: string | string[]; name?: string | string[] }>();
  const roleParam = asOne(params.role);
  const role: OperationsRole = roleParam === "driver" ? "driver" : "specialist";
  const personId = asOne(params.personId);
  const fallbackName = asOne(params.name);
  const { colors } = useTheme();
  const bootstrap = useBootstrap();
  const [period, setPeriod] = useState<ReportPeriod>("month");
  const range = reportRange(period, dayKeyFromToday(0));
  const report = useOperationsReport(
    range.from,
    range.to,
    "08:00",
    "22:00",
    bootstrap.data?.capabilities.canViewReports === true && Boolean(personId),
  );

  if (bootstrap.isSuccess && !bootstrap.data.capabilities.canViewReports) return <Redirect href="/inbox" />;
  if (report.isError) {
    return <ErrorState title="تعذّر تحميل تقرير الموظف" message={report.error.message} onRetry={() => void report.refetch()} />;
  }

  const person = report.data?.people[role].find((item) => item.id === personId);
  const name = person?.name || fallbackName || (role === "specialist" ? "الأخصائية" : "السائق");
  const events = (report.data?.events[role] ?? []).filter((event) => event.personIds.includes(personId));
  const visits = groupOperationsVisits(events);
  const groupedDays = visitsByDay(visits);
  const completedVisits = visits.filter((visit) => visit.completed).length;
  const completedServices = events.filter((event) => event.completed).length;
  const scheduledMinutes = events.reduce((total, event) => total + event.durationMinutes, 0);
  const completionRate = visits.length ? Math.round((completedVisits / visits.length) * 100) : 0;

  return (
    <>
      <Stack.Screen options={{ title: name }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={report.isRefetching} onRefresh={() => void report.refetch()} tintColor={colors.brand} />}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["5xl"], gap: spacing.lg }}
      >
        <Segmented
          options={periodOptions}
          value={period}
          onChange={setPeriod}
          accessibilityLabel="الفترة الزمنية للتقرير"
          testIDPrefix="employee-report-period"
        />

        <Text selectable style={{ ...type.footnote, ...numeric, ...rtlText, color: colors.textSecondary }}>
          {rangeLabel.format(new Date(`${range.from}T12:00:00+03:00`))} – {rangeLabel.format(new Date(`${range.to}T12:00:00+03:00`))} · توقيت الرياض
        </Text>

        {report.isLoading ? <ActivityIndicator size="large" color={colors.brand} /> : null}

        {report.data ? (
          <>
            <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: spacing.sm }}>
              <Metric icon="calendar" label="الزيارات المسندة" value={reportInteger.format(visits.length)} />
              <Metric icon="checkmark.circle" label="الزيارات المكتملة" value={reportInteger.format(completedVisits)} />
              <Metric
                icon={role === "specialist" ? "sparkles" : "car"}
                label={completedWorkLabel(role)}
                value={reportInteger.format(completedServices)}
              />
              <Metric icon="clock" label="ساعات العمل" value={reportDecimal.format(scheduledMinutes / 60)} />
            </View>

            <Card>
              <View style={{ flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", gap: spacing.md }}>
                <View style={{ flex: 1, gap: spacing.xs }}>
                  <Text selectable style={{ ...type.headline, ...rtlText, color: colors.text }}>{name}</Text>
                  <Text selectable style={{ ...type.footnote, ...rtlText, color: colors.textSecondary }}>
                    {person?.source === "rekaz" ? "مقدم خدمة من ركاز" : role === "specialist" ? "أخصائية ضمن فريق كيارا" : "سائق ضمن فريق كيارا"}
                  </Text>
                </View>
                <Text selectable style={{ ...type.title2, ...numeric, color: colors.brand }}>{reportInteger.format(completionRate)}%</Text>
              </View>
              <View style={{ height: spacing.sm, overflow: "hidden", borderRadius: radius.full, backgroundColor: colors.surfaceSunken }}>
                <View style={{ height: "100%", width: `${completionRate}%`, borderRadius: radius.full, backgroundColor: colors.success }} />
              </View>
              <Text selectable style={{ ...type.caption, ...rtlText, color: colors.textTertiary }}>
                نسبة إكمال الزيارات خلال الفترة المختارة
              </Text>
            </Card>

            <View style={{ gap: spacing.lg }}>
              <View style={{ gap: spacing.xs }}>
                <Text style={{ ...type.title3, ...rtlText, color: colors.text }}>الجدول الزمني</Text>
                <Text style={{ ...type.footnote, ...rtlText, color: colors.textSecondary }}>
                  كل بطاقة تمثل زيارة عميلة واحدة، وتجمع خدماتها داخلها.
                </Text>
              </View>

              {groupedDays.length ? groupedDays.map(([day, dayVisits]) => (
                <View key={day} style={{ gap: spacing.md }}>
                  <Text selectable style={{ ...type.subheadStrong, ...rtlText, color: colors.textSecondary }}>
                    {dayLabel.format(new Date(`${day}T12:00:00+03:00`))}
                  </Text>
                  {dayVisits.map((visit) => <VisitCard key={visit.key} visit={visit} />)}
                </View>
              )) : (
                <Card>
                  <Text style={{ ...type.body, ...rtlText, color: colors.textSecondary }}>
                    لا توجد زيارات لهذا الموظف خلال {period === "month" ? "هذا الشهر" : "هذا الأسبوع"}.
                  </Text>
                </Card>
              )}
            </View>
          </>
        ) : null}
      </ScrollView>
    </>
  );
}
