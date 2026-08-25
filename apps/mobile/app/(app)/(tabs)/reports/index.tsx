import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { Redirect } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";

import { PrimaryButton } from "@/components/primary-button";
import { ErrorState } from "@/components/screen-state";
import { Card, Divider } from "@/components/ui/card";
import { IconSymbol, type IconName } from "@/components/ui/icon-symbol";
import { Segmented, type SegmentOption } from "@/components/ui/segmented";
import { hitSize, numeric, radius, rtlText, spacing, type } from "@/constants/theme";
import { addDays, dayKeyFromToday } from "@/lib/calendar";
import { useBootstrap, useOperationsReport } from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";
import type { OperationsPerson, OperationsRole } from "@/types/api";

const roleOptions: SegmentOption<OperationsRole>[] = [
  { value: "specialist", label: "الأخصائيات" },
  { value: "driver", label: "السائقون" },
];

type PickerField = "from" | "to" | "startTime" | "endTime";
const dateLabel = new Intl.DateTimeFormat("ar-SA", { day: "numeric", month: "short", year: "numeric" });
const timeLabel = new Intl.DateTimeFormat("ar-SA", { hour: "numeric", minute: "2-digit" });
const eventTime = new Intl.DateTimeFormat("ar-SA", {
  timeZone: "Asia/Riyadh",
  hour: "numeric",
  minute: "2-digit",
});

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
  const [role, setRole] = useState<OperationsRole>("specialist");
  const [draft, setDraft] = useState({ from: today, to: addDays(today, 6), startTime: "08:00", endTime: "22:00" });
  const [applied, setApplied] = useState(draft);
  const [picker, setPicker] = useState<PickerField | null>(null);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const report = useOperationsReport(applied.from, applied.to, applied.startTime, applied.endTime, bootstrap.data?.session.role === "admin");

  if (bootstrap.isSuccess && bootstrap.data.session.role !== "admin") return <Redirect href="/inbox" />;
  if (report.isError) {
    return <ErrorState title="تعذّر تحميل التقرير" message={report.error.message} onRetry={() => void report.refetch()} />;
  }

  const people = report.data?.people[role] ?? [];
  const activePersonId = selectedPersonId && people.some((person) => person.id === selectedPersonId)
    ? selectedPersonId
    : people[0]?.id ?? null;
  const selectedPerson = people.find((person) => person.id === activePersonId);
  const events = (report.data?.events[role] ?? []).filter((event) => activePersonId && event.personIds.includes(activePersonId));
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
      refreshControl={<RefreshControl refreshing={report.isRefetching} onRefresh={() => void report.refetch()} tintColor={colors.brand} />}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["5xl"], gap: spacing.lg }}
    >
      <Segmented
        options={roleOptions}
        value={role}
        onChange={(value) => { setRole(value); setSelectedPersonId(null); }}
        accessibilityLabel="اختيار فريق التقرير"
        testIDPrefix="reports-role"
      />

      <Card>
        <View style={{ gap: spacing.xs }}>
          <Text style={{ ...type.headline, ...rtlText, color: colors.text }}>نطاق التقرير</Text>
          <Text style={{ ...type.footnote, ...rtlText, color: colors.textSecondary }}>التوقيت حسب مدينة الرياض، والحد الأقصى ٣١ يوماً.</Text>
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

      {picker ? (
        <DateTimePicker
          testID="reports-date-time-picker"
          value={pickerValue(picker, values)}
          mode={picker === "from" || picker === "to" ? "date" : "time"}
          minuteInterval={15}
          onChange={onPickerChange}
        />
      ) : null}

      {report.isLoading ? <ActivityIndicator size="large" color={colors.brand} /> : null}

      {report.data ? (
        <>
          <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: spacing.sm }}>
            <Metric icon="person.2" label="مسند" value={totals.assigned.toLocaleString("ar-SA")} />
            <Metric icon="checkmark.circle" label="مكتمل" value={totals.completed.toLocaleString("ar-SA")} />
            <Metric icon="clock" label="ساعات" value={(totals.minutes / 60).toLocaleString("ar-SA", { maximumFractionDigits: 1 })} />
          </View>

          <Card padded={false}>
            <View style={{ padding: spacing.lg, gap: spacing.xs }}>
              <Text style={{ ...type.headline, ...rtlText, color: colors.text }}>الفريق</Text>
              <Text style={{ ...type.footnote, ...rtlText, color: colors.textSecondary }}>اختاري اسماً لعرض حجوزاته وطلباته بالتوقيت.</Text>
            </View>
            {people.map((person: OperationsPerson, index) => {
              const active = person.id === activePersonId;
              return (
                <View key={person.id}>
                  {index ? <Divider inset={spacing.lg} /> : null}
                  <Pressable
                    testID={`reports-person-${person.id}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => setSelectedPersonId(person.id)}
                    style={({ pressed }) => ({
                      minHeight: hitSize.control,
                      padding: spacing.lg,
                      flexDirection: "row-reverse",
                      alignItems: "center",
                      gap: spacing.md,
                      backgroundColor: active ? colors.brandSoft : colors.surface,
                      opacity: pressed ? 0.65 : 1,
                    })}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{ ...type.bodyStrong, ...rtlText, color: colors.text }}>{person.name}</Text>
                      <Text style={{ ...type.footnote, ...numeric, ...rtlText, color: colors.textSecondary }}>
                        {person.assignedCount.toLocaleString("ar-SA")} مسند · {person.completedCount.toLocaleString("ar-SA")} مكتمل · {(person.scheduledMinutes / 60).toLocaleString("ar-SA", { maximumFractionDigits: 1 })} ساعة
                      </Text>
                    </View>
                    <IconSymbol name={active ? "checkmark.circle" : "chevron.left"} size={20} color={active ? colors.brand : colors.textTertiary} />
                  </Pressable>
                </View>
              );
            })}
          </Card>

          <Card>
            <View style={{ gap: spacing.xs }}>
              <Text style={{ ...type.headline, ...rtlText, color: colors.text }}>حجوزات وطلبات {selectedPerson?.name ?? "الفريق"}</Text>
              <Text style={{ ...type.footnote, ...rtlText, color: colors.textSecondary }}>مرتبة زمنياً خلال النطاق المختار.</Text>
            </View>
            {events.length ? events.map((event, index) => (
              <View key={`${event.id}-${index}`} style={{ flexDirection: "row-reverse", gap: spacing.md }}>
                <View style={{ alignItems: "center" }}>
                  <View style={{ width: 12, height: 12, borderRadius: radius.full, backgroundColor: event.completed ? colors.success : colors.brand }} />
                  {index < events.length - 1 ? <View style={{ width: 2, flex: 1, minHeight: spacing["3xl"], backgroundColor: colors.border }} /> : null}
                </View>
                <View style={{ flex: 1, paddingBottom: spacing.md }}>
                  <Text style={{ ...type.caption, ...numeric, ...rtlText, color: colors.brand }}>{eventTime.format(new Date(event.arrivalAt))} · {event.durationMinutes.toLocaleString("ar-SA")} د</Text>
                  <Text style={{ ...type.bodyStrong, ...rtlText, color: colors.text }}>{event.customerName || event.customerPhone}</Text>
                  <Text style={{ ...type.footnote, ...rtlText, color: colors.textSecondary }}>{event.service} · {event.sourceLabel}{event.completed ? " · مكتمل" : ""}</Text>
                </View>
              </View>
            )) : (
              <Text style={{ ...type.body, ...rtlText, color: colors.textSecondary }}>لا توجد حجوزات أو طلبات لهذا الاسم ضمن الفلاتر.</Text>
            )}
          </Card>
        </>
      ) : null}
    </ScrollView>
  );
}
