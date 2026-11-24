import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useState } from "react";

import { ErrorState } from "@/components/screen-state";
import {
  createReportDateSelection,
  ReportDateRangeFilter,
  type ReportDateSelection,
} from "@/components/reports/report-date-range-filter";
import { DriverTripLog } from "@/components/reports/driver-trip-log";
import { VisitCard } from "@/components/reports/visit-card";
import { Card } from "@/components/ui/card";
import { IconSymbol, type IconName } from "@/components/ui/icon-symbol";
import { Segmented, type SegmentOption } from "@/components/ui/segmented";
import { numeric, radius, rtlText, spacing, type } from "@/constants/theme";
import { dayKeyFromToday } from "@/lib/calendar";
import {
  completedWorkLabel,
  delayLabel,
  groupOperationsVisits,
  matchesDriverTripFilter,
  reportDecimal,
  reportInteger,
  visitsByDay,
  type DriverTripFilter,
} from "@/lib/operations-report";
import { useBootstrap, useOperationsReport } from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";
import type { DriverStepSummary, OperationsRole } from "@/types/api";

const dayLabel = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
  timeZone: "Asia/Riyadh",
  weekday: "long",
  day: "numeric",
  month: "long",
});
const currency = new Intl.NumberFormat("en-US-u-ca-gregory-nu-latn", {
  style: "currency",
  currency: "SAR",
  maximumFractionDigits: 2,
});

function Metric({
  icon,
  label,
  value,
  onPress,
  expanded,
}: {
  icon: IconName;
  label: string;
  value: string;
  /** Makes the tile a toggle for a detail panel shown under the tiles. */
  onPress?: () => void;
  expanded?: boolean;
}) {
  const { colors } = useTheme();
  const body = (
    <>
      <View style={{ flexDirection: "row-reverse", justifyContent: "space-between", alignItems: "center" }}>
        <IconSymbol name={icon} size={18} color={colors.brand} />
        {onPress ? (
          <IconSymbol name={expanded ? "chevron.up" : "chevron.down"} size={14} color={colors.textTertiary} />
        ) : null}
      </View>
      <Text style={{ ...type.caption, ...rtlText, color: colors.textTertiary }}>{label}</Text>
      <Text selectable={!onPress} style={{ ...type.title3, ...numeric, ...rtlText, color: colors.text }}>{value}</Text>
    </>
  );
  const style = {
    flex: 1,
    minWidth: 130,
    padding: spacing.md,
    gap: spacing.xs,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: expanded ? 1 : 0,
    borderColor: colors.brand,
  } as const;
  if (!onPress) return <View style={style}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ expanded: Boolean(expanded) }}
      accessibilityLabel={`${label} ${value}، اضغطي لعرض التفاصيل`}
      testID="trip-costs-metric"
      style={({ pressed }) => [style, { opacity: pressed ? 0.7 : 1 }]}
    >
      {body}
    </Pressable>
  );
}

/** One line of the trip-fee breakdown: how many trips and what they come to. */
function FeeRow({
  label,
  count,
  amount,
  tone,
  onPress,
  strong,
}: {
  label: string;
  count: number;
  amount: string | null;
  tone: string;
  onPress?: () => void;
  strong?: boolean;
}) {
  const { colors } = useTheme();
  const row = (
    <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xs }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tone }} />
      <Text style={{ ...(strong ? type.subheadStrong : type.subhead), ...rtlText, color: colors.text, flex: 1 }}>
        {label}
        <Text style={{ ...numeric, color: colors.textSecondary }}> · {reportInteger.format(count)} مشوار</Text>
      </Text>
      {amount != null ? (
        <Text selectable style={{ ...(strong ? type.subheadStrong : type.subhead), ...numeric, color: colors.text }}>
          {amount}
        </Text>
      ) : null}
      {onPress ? <IconSymbol name="chevron.left" size={12} color={colors.textTertiary} /> : null}
    </View>
  );
  if (!onPress) return row;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
      {row}
    </Pressable>
  );
}

/** One arrival step over the whole range: how often late, and by how much. */
function LatenessRow({ title, summary }: { title: string; summary: DriverStepSummary }) {
  const { colors } = useTheme();
  const judged = summary.onTime + summary.late;
  return (
    <View style={{ gap: spacing.xs }}>
      <View style={{ flexDirection: "row-reverse", alignItems: "baseline", justifyContent: "space-between", gap: spacing.md }}>
        <Text style={{ ...type.subheadStrong, ...rtlText, color: colors.text }}>{title}</Text>
        <Text selectable style={{ ...type.subheadStrong, ...numeric, color: summary.late ? colors.danger : colors.success }}>
          {reportInteger.format(summary.late)} متأخر من {reportInteger.format(judged)}
        </Text>
      </View>
      <Text selectable style={{ ...type.caption, ...numeric, ...rtlText, color: colors.textSecondary }}>
        {summary.medianLateMinutes != null
          ? `التأخير المعتاد ${delayLabel(summary.medianLateMinutes)}`
          : "لا يوجد تأخير مسجل"}
        {summary.missing ? ` · ${reportInteger.format(summary.missing)} لم يُسجَّل` : ""}
      </Text>
    </View>
  );
}

function asOne(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function initialSelection(from: string, to: string): ReportDateSelection {
  const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
  const span = Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`);
  if (dayPattern.test(from) && dayPattern.test(to) && span >= 0 && span <= 30 * 86_400_000) {
    return { preset: "custom", from, to };
  }
  return createReportDateSelection("month", dayKeyFromToday(0));
}

export default function EmployeeReportScreen() {
  const params = useLocalSearchParams<{
    role?: string | string[];
    personId?: string | string[];
    name?: string | string[];
    from?: string | string[];
    to?: string | string[];
    startTime?: string | string[];
    endTime?: string | string[];
  }>();
  const roleParam = asOne(params.role);
  const role: OperationsRole = roleParam === "driver" ? "driver" : "specialist";
  const personId = asOne(params.personId);
  const fallbackName = asOne(params.name);
  const { colors } = useTheme();
  const bootstrap = useBootstrap();
  const [range, setRange] = useState(() => initialSelection(asOne(params.from), asOne(params.to)));
  const [tripFilter, setTripFilter] = useState<DriverTripFilter>("all");
  const [showFeeBreakdown, setShowFeeBreakdown] = useState(false);
  const startTime = asOne(params.startTime) || "00:00";
  const endTime = asOne(params.endTime) || "23:59";
  const report = useOperationsReport(
    range.from,
    range.to,
    startTime,
    endTime,
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
  const lateness = role === "driver" ? person?.lateness ?? null : null;
  const serviceTiming = role === "specialist" ? person?.serviceTiming ?? null : null;
  const toleranceMinutes = report.data?.serviceToleranceMinutes ?? 0;
  const count = (filter: DriverTripFilter) =>
    visits.filter((visit) => matchesDriverTripFilter(visit, filter)).length;
  const tripFilters: SegmentOption<DriverTripFilter>[] = [
    { value: "all", label: "الكل", count: visits.length },
    { value: "open", label: "لم تكتمل", count: count("open") },
    { value: "late_client", label: "وصل متأخراً", count: count("late_client") },
    { value: "done", label: "مكتملة", count: count("done") },
  ];
  const tripLogDays = visitsByDay(
    visits.filter((visit) => matchesDriverTripFilter(visit, tripFilter)),
  );
  const groupedDays = visitsByDay(visits);
  const completedVisits = visits.filter((visit) => visit.completed).length;
  const completedServices = events.filter((event) => event.completed).length;
  const scheduledMinutes = events.reduce((total, event) => total + event.durationMinutes, 0);
  const completionRate = visits.length ? Math.round((completedVisits / visits.length) * 100) : 0;
  const recordedTripCosts = visits.filter((visit) => visit.tripCost != null).length;
  const totalTripCosts = visits.reduce(
    (total, visit) => total + (visit.tripCost ?? 0),
    0,
  );
  const finishedVisits = visits.filter((visit) => visit.completed);
  const openVisits = visits.filter((visit) => !visit.completed);
  const sumCosts = (list: typeof visits) => list.reduce((total, visit) => total + (visit.tripCost ?? 0), 0);
  const unpricedTrips = visits.length - recordedTripCosts;

  return (
    <>
      <Stack.Screen options={{ title: name }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={report.isRefetching} onRefresh={() => void report.refetch()} tintColor={colors.brand} />}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["5xl"], gap: spacing.lg }}
      >
        <ReportDateRangeFilter
          value={range}
          onChange={setRange}
          accessibilityLabel="الفترة الزمنية للتقرير"
          testIDPrefix="employee-report-period"
        />

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
              {role === "driver" ? (
                <Metric
                  icon="banknote"
                  label="إجمالي رسوم المشاوير"
                  value={currency.format(totalTripCosts)}
                  onPress={() => setShowFeeBreakdown((open) => !open)}
                  expanded={showFeeBreakdown}
                />
              ) : null}
            </View>

            {role === "driver" && showFeeBreakdown ? (
              <Card>
                <Text style={{ ...type.headline, ...rtlText, color: colors.text }}>تفصيل رسوم المشاوير</Text>
                <FeeRow
                  label="مكتملة"
                  count={finishedVisits.length}
                  amount={currency.format(sumCosts(finishedVisits))}
                  tone={colors.success}
                  onPress={() => setTripFilter("done")}
                />
                <FeeRow
                  label="لم تكتمل"
                  count={openVisits.length}
                  amount={currency.format(sumCosts(openVisits))}
                  tone={colors.warning}
                  onPress={() => setTripFilter("open")}
                />
                {unpricedTrips ? (
                  <FeeRow label="بدون رسوم مسجلة" count={unpricedTrips} amount={null} tone={colors.textTertiary} />
                ) : null}
                <View style={{ height: 1, backgroundColor: colors.border }} />
                <FeeRow label="الإجمالي" count={visits.length} amount={currency.format(totalTripCosts)} tone="transparent" strong />
                <Text style={{ ...type.caption, ...rtlText, color: colors.textSecondary }}>
                  «لم تكتمل» يعني أن السائق لم يضغط خطوة الإنهاء في التطبيق، وليس بالضرورة أن المشوار لم يتم. اضغطي على أي سطر لعرض مشاويره في السجل أدناه.
                </Text>
              </Card>
            ) : null}

            {role === "driver" ? (
              <Text selectable style={{ ...type.footnote, ...numeric, ...rtlText, color: colors.textSecondary }}>
                رسوم مسجلة لـ {reportInteger.format(recordedTripCosts)} من {reportInteger.format(visits.length)} مشوار
              </Text>
            ) : null}

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

            {serviceTiming ? (
              <Card>
                <Text style={{ ...type.headline, ...rtlText, color: colors.text }}>إنهاء الخدمة في وقتها</Text>
                {serviceTiming.timed ? (
                  <>
                    <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: spacing.sm }}>
                      <Metric icon="checkmark.circle" label="في الوقت المتوقع" value={reportInteger.format(serviceTiming.onTime)} />
                      <Metric icon="exclamationmark.circle" label="أنهت متأخرة" value={reportInteger.format(serviceTiming.late)} />
                      <Metric icon="clock" label="أنهت مبكرة" value={reportInteger.format(serviceTiming.early)} />
                      <Metric icon="info.circle" label="ضُغط الإنهاء بعد ساعات" value={reportInteger.format(serviceTiming.unreliable)} />
                    </View>
                    {serviceTiming.medianLateMinutes != null ? (
                      <Text selectable style={{ ...type.footnote, ...numeric, ...rtlText, color: colors.textSecondary }}>
                        التأخير المعتاد عند الإنهاء متأخرة {delayLabel(serviceTiming.medianLateMinutes)}
                      </Text>
                    ) : null}
                  </>
                ) : (
                  <Text style={{ ...type.body, ...rtlText, color: colors.textSecondary }}>
                    لم يُضغط «إنهاء الخدمة» في أي زيارة خلال الفترة المختارة.
                  </Text>
                )}
                <Text selectable style={{ ...type.caption, ...numeric, ...rtlText, color: colors.textTertiary }}>
                  الانتهاء المتوقع = وقت الحجز + مجموع مدد الخدمات المحجوزة، ويُقارن بضغط «إنهاء الخدمة»
                  {toleranceMinutes
                    ? `، مع سماح ${reportInteger.format(toleranceMinutes)} دقيقة قبله أو بعده.`
                    : " بالدقيقة: بعده ولو بدقيقة تأخير، وقبله بدقيقة إنهاء مبكر."}
                </Text>
              </Card>
            ) : null}

            {lateness ? (
              <Card>
                <Text style={{ ...type.headline, ...rtlText, color: colors.text }}>الوصول للعميلة في وقت الحجز</Text>
                <LatenessRow title="وصل للعميلة" summary={lateness.client} />
                <Text selectable style={{ ...type.caption, ...numeric, ...rtlText, color: colors.textTertiary }}>
                  يُحسب من وقت الحجز تماماً: ضغط السائق «وصلت للعميلة» بعده ولو بدقيقة تأخير.
                </Text>
              </Card>
            ) : null}

            {lateness ? (
              <View style={{ gap: spacing.md }}>
                <View style={{ gap: spacing.xs }}>
                  <Text style={{ ...type.title3, ...rtlText, color: colors.text }}>سجل المشاوير</Text>
                  <Text style={{ ...type.footnote, ...rtlText, color: colors.textSecondary }}>
                    كل مشوار للسائق: هل اكتمل، ومتى كان مطلوبًا ومتى ضغط على الخطوتين.
                  </Text>
                </View>
                <Segmented
                  options={tripFilters}
                  value={tripFilter}
                  onChange={setTripFilter}
                  layout="scroll"
                  accessibilityLabel="تصفية المشاوير"
                  testIDPrefix="driver-trips-filter"
                />
                {tripLogDays.length ? tripLogDays.map(([day, dayVisits]) => (
                  <View key={day} style={{ gap: spacing.sm }}>
                    <Text selectable style={{ ...type.subheadStrong, ...rtlText, color: colors.textSecondary }}>
                      {dayLabel.format(new Date(`${day}T12:00:00+03:00`))}
                    </Text>
                    <DriverTripLog visits={dayVisits} />
                  </View>
                )) : (
                  <Card>
                    <Text style={{ ...type.body, ...rtlText, color: colors.textSecondary }}>
                      لا توجد مشاوير بهذا التصنيف خلال الفترة المختارة.
                    </Text>
                  </Card>
                )}
              </View>
            ) : null}

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
                    لا توجد زيارات لهذا الموظف خلال الفترة المختارة.
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
