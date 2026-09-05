import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { Link, Redirect } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/components/primary-button";
import { CustomerServiceTeam } from "@/components/reports/customer-service-team";
import { OrdersSummary } from "@/components/reports/orders-summary";
import { ErrorState } from "@/components/screen-state";
import { Card } from "@/components/ui/card";
import { IconSymbol, type IconName } from "@/components/ui/icon-symbol";
import { Segmented, type SegmentOption } from "@/components/ui/segmented";
import { hitSize, numeric, radius, rtlText, spacing, type } from "@/constants/theme";
import { addDays, dayKeyFromToday } from "@/lib/calendar";
import {
  REPORT_LOCALE,
  reportDecimal,
  reportInteger,
  reportRange,
  type ReportPeriod,
} from "@/lib/operations-report";
import { useBootstrap, useCustomerServiceReport, useOperationsReport, useOrdersReport } from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";
import type { OperationsPerson, OperationsRole } from "@/types/api";

type ReportTeam = OperationsRole | "customer-service" | "orders";

const roleOptions: SegmentOption<ReportTeam>[] = [
  { value: "orders", label: "الطلبات" },
  { value: "customer-service", label: "خدمة العملاء" },
  { value: "specialist", label: "الأخصائيات" },
  { value: "driver", label: "السائقون" },
];
const summaryPeriods: SegmentOption<ReportPeriod>[] = [
  { value: "today", label: "اليوم" },
  { value: "week", label: "هذا الأسبوع" },
  { value: "month", label: "هذا الشهر" },
];

type PickerField = "from" | "to" | "startTime" | "endTime";
const dateLabel = new Intl.DateTimeFormat(REPORT_LOCALE, { day: "numeric", month: "short", year: "numeric" });
const timeLabel = new Intl.DateTimeFormat(REPORT_LOCALE, { hour: "numeric", minute: "2-digit" });

function dayToDate(day: string) {
  return new Date(`${day}T12:00:00+03:00`);
}

function timeToDate(time: string) {
  return new Date(`2026-01-01T${time}:00+03:00`);
}

function pickerValue(field: PickerField, values: Record<PickerField, string>) {
  return field === "from" || field === "to" ? dayToDate(values[field]) : timeToDate(values[field]);
}

function Metric({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, minWidth: 96, gap: spacing.xs, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface }}>
      <IconSymbol name={icon} size={18} color={colors.brand} />
      <Text style={{ ...type.caption, ...rtlText, color: colors.textTertiary }}>{label}</Text>
      <Text style={{ ...type.title3, ...numeric, ...rtlText, color: colors.text }}>{value}</Text>
    </View>
  );
}

function FilterButton({ testID, label, value, onPress }: { testID: string; label: string; value: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${label}، ${value}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minWidth: 140,
        minHeight: hitSize.comfortable,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.md,
        backgroundColor: colors.surface,
        opacity: pressed ? 0.65 : 1,
      })}
    >
      <Text style={{ ...type.caption, ...rtlText, color: colors.textTertiary }}>{label}</Text>
      <Text style={{ ...type.subheadStrong, ...numeric, ...rtlText, color: colors.text }}>{value}</Text>
    </Pressable>
  );
}

export default function ReportsScreen() {
  const { colors } = useTheme();
  const bootstrap = useBootstrap();
  const today = dayKeyFromToday(0);
  const [role, setRole] = useState<ReportTeam>("customer-service");
  const [summaryPeriod, setSummaryPeriod] = useState<ReportPeriod>("today");
  const [draft, setDraft] = useState({ from: today, to: addDays(today, 6), startTime: "08:00", endTime: "22:00" });
  const [applied, setApplied] = useState(draft);
  const [picker, setPicker] = useState<PickerField | null>(null);
  const summaryRange = reportRange(summaryPeriod, today);
  const canViewReports = bootstrap.data?.capabilities.canViewReports === true;
  const operationsReport = useOperationsReport(
    applied.from,
    applied.to,
    applied.startTime,
    applied.endTime,
    canViewReports && role !== "customer-service",
  );
  const customerServiceReport = useCustomerServiceReport(
    summaryRange.from,
    summaryRange.to,
    "00:00",
    "23:59",
    canViewReports && role === "customer-service",
  );
  const ordersReport = useOrdersReport(
    summaryRange.from,
    summaryRange.to,
    canViewReports && role === "orders",
  );
  const activeReport = role === "customer-service"
    ? customerServiceReport
    : role === "orders"
      ? ordersReport
      : operationsReport;

  if (bootstrap.isSuccess && !bootstrap.data.capabilities.canViewReports) return <Redirect href="/inbox" />;
  if (activeReport.isError) {
    return <ErrorState title="تعذّر تحميل التقرير" message={activeReport.error.message} onRetry={() => void activeReport.refetch()} />;
  }

  const operationsRole: OperationsRole = role === "driver" ? "driver" : "specialist";
  const people = operationsReport.data?.people[operationsRole] ?? [];
  const totals = people.reduce(
      (value, person) => ({
        assigned: value.assigned + person.assignedCount,
        completed: value.completed + person.completedCount,
        minutes: value.minutes + person.scheduledMinutes,
      }),
      { assigned: 0, completed: 0, minutes: 0 },
  );

  const values: Record<PickerField, string> = draft;
  function onPickerChange(event: DateTimePickerEvent, value?: Date) {
    setPicker(null);
    if (event.type === "dismissed" || !value || !picker) return;
    if (picker === "from" || picker === "to") {
      const day = value.toISOString().slice(0, 10);
      setDraft((current) => ({ ...current, [picker]: day }));
    } else {
      const time = `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
      setDraft((current) => ({ ...current, [picker]: time }));
    }
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl refreshing={activeReport.isRefetching} onRefresh={() => void activeReport.refetch()} tintColor={colors.brand} />}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["5xl"], gap: spacing.lg }}
    >
      <Segmented
        options={roleOptions}
        value={role}
        onChange={setRole}
        accessibilityLabel="اختيار فريق التقرير"
        testIDPrefix="reports-role"
        layout="scroll"
      />

      {role === "customer-service" || role === "orders" ? (
        <Card>
          <View style={{ gap: spacing.xs }}>
            <Text style={{ ...type.headline, ...rtlText, color: colors.text }}>
              {role === "orders" ? "ملخص الطلبات" : "المحادثات التي تم التعامل معها"}
            </Text>
            <Text style={{ ...type.footnote, ...rtlText, color: colors.textSecondary }}>
              {role === "orders"
                ? "الطلبات مجمعة حسب موعد الزيارة، وتشمل طلبات ركاز والطلبات المنشأة من واتساب."
                : "يعتمد التقرير على الرد أو الاستلام أو أي إجراء داخل المحادثة، بغض النظر عمّن استلمها أولاً."}
            </Text>
          </View>
          <Segmented
            options={summaryPeriods}
            value={summaryPeriod}
            onChange={setSummaryPeriod}
            accessibilityLabel={role === "orders" ? "فترة تقرير الطلبات" : "فترة تقرير خدمة العملاء"}
            testIDPrefix={`${role}-period`}
          />
          <Text selectable style={{ ...type.footnote, ...numeric, ...rtlText, color: colors.textSecondary }}>
            {dateLabel.format(dayToDate(summaryRange.from))} – {dateLabel.format(dayToDate(summaryRange.to))} · توقيت الرياض
          </Text>
        </Card>
      ) : (
      <Card>
        <View style={{ gap: spacing.xs }}>
          <Text style={{ ...type.headline, ...rtlText, color: colors.text }}>نطاق التقرير</Text>
          <Text style={{ ...type.footnote, ...rtlText, color: colors.textSecondary }}>التوقيت حسب مدينة الرياض، والحد الأقصى 31 يوماً.</Text>
        </View>
        <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: spacing.sm }}>
          <FilterButton testID="reports-from-date" label="من تاريخ" value={dateLabel.format(dayToDate(draft.from))} onPress={() => setPicker("from")} />
          <FilterButton testID="reports-to-date" label="إلى تاريخ" value={dateLabel.format(dayToDate(draft.to))} onPress={() => setPicker("to")} />
          <FilterButton testID="reports-start-time" label="من الساعة" value={timeLabel.format(timeToDate(draft.startTime))} onPress={() => setPicker("startTime")} />
          <FilterButton testID="reports-end-time" label="إلى الساعة" value={timeLabel.format(timeToDate(draft.endTime))} onPress={() => setPicker("endTime")} />
        </View>
        <PrimaryButton
          testID="reports-apply-filters"
          label="تطبيق الفلاتر"
          icon="slider.horizontal.3"
          disabled={draft.to < draft.from || draft.endTime <= draft.startTime}
          onPress={() => setApplied(draft)}
        />
      </Card>
      )}

      {role !== "customer-service" && role !== "orders" && picker ? (
        <DateTimePicker
          testID="reports-date-time-picker"
          value={pickerValue(picker, values)}
          mode={picker === "from" || picker === "to" ? "date" : "time"}
          locale="en_US"
          minuteInterval={15}
          onChange={onPickerChange}
        />
      ) : null}

      {activeReport.isLoading ? <ActivityIndicator size="large" color={colors.brand} /> : null}

      {role === "customer-service" && customerServiceReport.data ? (
        <CustomerServiceTeam report={customerServiceReport.data} />
      ) : role === "orders" && ordersReport.data ? (
        <OrdersSummary report={ordersReport.data} />
      ) : operationsReport.data && (role === "specialist" || role === "driver") ? (
        <>
          <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: spacing.sm }}>
            <Metric icon="person.2" label="مسند" value={reportInteger.format(totals.assigned)} />
            <Metric icon="checkmark.circle" label="مكتمل" value={reportInteger.format(totals.completed)} />
            <Metric icon="clock" label="ساعات" value={reportDecimal.format(totals.minutes / 60)} />
          </View>

          <Card padded={false}>
            <View
              style={{
                marginHorizontal: spacing.lg,
                paddingVertical: spacing.lg,
                gap: spacing.xs,
              }}
            >
              <Text style={{ ...type.headline, ...rtlText, color: colors.text }}>الفريق</Text>
              <Text style={{ ...type.footnote, ...rtlText, color: colors.textSecondary }}>اضغطي على الاسم لعرض الأداء والحجوزات مجمّعة حسب زيارة العميلة.</Text>
            </View>
            {people.map((person: OperationsPerson, index) => {
              return (
                <View key={person.id}>
                  {index ? (
                    <View
                      style={{
                        height: StyleSheet.hairlineWidth,
                        marginHorizontal: spacing.lg,
                        backgroundColor: colors.border,
                      }}
                    />
                  ) : null}
                  <Link
                    href={{
                      pathname: "/reports/[role]/[personId]",
                      params: { role: operationsRole, personId: person.id, name: person.name },
                    }}
                    asChild
                  >
                    <Pressable
                      testID={`reports-person-${person.id}`}
                      accessibilityRole="button"
                      accessibilityLabel={`تفاصيل أداء ${person.name}`}
                      accessibilityHint="يفتح تقرير الموظف الأسبوعي والشهري"
                      style={({ pressed }) => ({
                        backgroundColor: colors.surface,
                        opacity: pressed ? 0.65 : 1,
                      })}
                    >
                      <View
                        style={{
                          minHeight: hitSize.control,
                          marginHorizontal: spacing.lg,
                          paddingVertical: spacing.md,
                          justifyContent: "center",
                        }}
                      >
                        <View style={{ marginLeft: hitSize.min + spacing.sm, gap: spacing.xs }}>
                          <Text selectable style={{ ...type.bodyStrong, ...rtlText, color: colors.text }}>{person.name}</Text>
                          <Text selectable style={{ ...type.footnote, ...numeric, ...rtlText, color: colors.textSecondary }}>
                            {reportInteger.format(person.assignedCount)} مسند · {reportInteger.format(person.completedCount)} مكتمل · {reportDecimal.format(person.scheduledMinutes / 60)} ساعة
                          </Text>
                        </View>
                        <View
                          pointerEvents="none"
                          style={{
                            position: "absolute",
                            left: spacing.none,
                            top: spacing.none,
                            bottom: spacing.none,
                            width: hitSize.min,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <IconSymbol name="chevron.left" size={20} color={colors.textTertiary} />
                        </View>
                      </View>
                    </Pressable>
                  </Link>
                </View>
              );
            })}
          </Card>
        </>
      ) : null}
    </ScrollView>
  );
}
