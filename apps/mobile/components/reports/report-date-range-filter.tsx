import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PrimaryButton } from "@/components/primary-button";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { hitSize, numeric, radius, rtlText, spacing, type } from "@/constants/theme";
import { addDays, dayKeyFromToday } from "@/lib/calendar";
import { REPORT_LOCALE, reportRange, type ReportPeriod } from "@/lib/operations-report";
import { useTheme } from "@/providers/theme-provider";

export type ReportDatePreset = ReportPeriod | "custom";

export type ReportDateSelection = {
  preset: ReportDatePreset;
  from: string;
  to: string;
};

const rangeLabel = new Intl.DateTimeFormat(REPORT_LOCALE, {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const OPTIONS: { value: ReportDatePreset; label: string; hint: string }[] = [
  { value: "today", label: "يوم محدد", hint: "اختيار تاريخ واحد" },
  { value: "week", label: "أسبوع", hint: "الأسبوع الحالي" },
  { value: "month", label: "شهر", hint: "الشهر الحالي" },
  { value: "custom", label: "فترة مخصصة", hint: "تحديد تاريخ البداية والنهاية" },
];

function dayToDate(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year!, month! - 1, date!, 12);
}

function dateToDay(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

export function createReportDateSelection(
  preset: ReportPeriod = "month",
  today = dayKeyFromToday(0),
): ReportDateSelection {
  return { preset, ...reportRange(preset, today) };
}

function DateButton({
  label,
  value,
  testID,
  onPress,
}: {
  label: string;
  value: string;
  testID: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${label}، ${rangeLabel.format(dayToDate(value))}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minWidth: 132,
        minHeight: hitSize.comfortable,
        justifyContent: "center",
        gap: spacing.xs,
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
      <Text style={{ ...type.subheadStrong, ...numeric, ...rtlText, color: colors.text }}>
        {rangeLabel.format(dayToDate(value))}
      </Text>
    </Pressable>
  );
}

function rangeText(value: Pick<ReportDateSelection, "from" | "to">) {
  const from = rangeLabel.format(dayToDate(value.from));
  return value.from === value.to ? from : `${from} – ${rangeLabel.format(dayToDate(value.to))}`;
}

function PeriodChoice({
  label,
  hint,
  selected,
  testID,
  onPress,
}: {
  label: string;
  hint: string;
  selected: boolean;
  testID: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label}، ${hint}`}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: hitSize.control,
        flexDirection: "row-reverse",
        alignItems: "center",
        gap: spacing.md,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderWidth: 1,
        borderColor: selected ? colors.brand : colors.border,
        borderRadius: radius.md,
        borderCurve: "continuous",
        backgroundColor: selected ? colors.brandSoft : colors.surface,
        opacity: pressed ? 0.65 : 1,
      })}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...type.subheadStrong, ...rtlText, color: selected ? colors.onBrandSoft : colors.text }}>
          {label}
        </Text>
        <Text style={{ ...type.caption, ...rtlText, color: colors.textSecondary }}>{hint}</Text>
      </View>
      <IconSymbol
        name={selected ? "checkmark.circle" : "calendar"}
        size={20}
        color={selected ? colors.brand : colors.textTertiary}
      />
    </Pressable>
  );
}

export function ReportDateRangeFilter({
  value,
  onChange,
  accessibilityLabel,
  testIDPrefix,
}: {
  value: ReportDateSelection;
  onChange: (value: ReportDateSelection) => void;
  accessibilityLabel: string;
  testIDPrefix: string;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [picker, setPicker] = useState<"day" | "from" | "to" | null>(null);

  function openModal() {
    setDraft(value);
    setPicker(null);
    setOpen(true);
  }

  function selectPreset(preset: ReportDatePreset) {
    if (preset === "today") {
      setDraft((current) => ({ preset, from: current.from, to: current.from }));
      setPicker("day");
      return;
    }
    if (preset === "custom") {
      setDraft((current) => ({ ...current, preset }));
      return;
    }
    setPicker(null);
    setDraft({ preset, ...reportRange(preset, dayKeyFromToday(0)) });
  }

  function onPickerChange(event: DateTimePickerEvent, selected?: Date) {
    const field = picker;
    setPicker(null);
    if (event.type === "dismissed" || !selected || !field) return;

    const day = dateToDay(selected);
    if (field === "day") {
      setDraft({ preset: "today", from: day, to: day });
    } else if (field === "from") {
      const latestTo = addDays(day, 30);
      const to = draft.to < day ? day : draft.to > latestTo ? latestTo : draft.to;
      setDraft({ preset: "custom", from: day, to });
    } else {
      const earliestFrom = addDays(day, -30);
      const from = draft.from > day ? day : draft.from < earliestFrom ? earliestFrom : draft.from;
      setDraft({ preset: "custom", from, to: day });
    }
  }

  return (
    <>
      <Pressable
        testID={`${testIDPrefix}-open`}
        accessibilityRole="button"
        accessibilityLabel={`${accessibilityLabel}، ${rangeText(value)}`}
        accessibilityHint="يفتح خيارات التاريخ والفترة"
        onPress={openModal}
        style={({ pressed }) => ({
          minHeight: hitSize.comfortable,
          flexDirection: "row-reverse",
          alignItems: "center",
          gap: spacing.md,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.md,
          borderCurve: "continuous",
          backgroundColor: colors.surface,
          opacity: pressed ? 0.65 : 1,
        })}
      >
        <IconSymbol name="calendar" size={20} color={colors.brand} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ ...type.caption, ...rtlText, color: colors.textTertiary }}>تاريخ التقرير</Text>
          <Text selectable style={{ ...type.subheadStrong, ...numeric, ...rtlText, color: colors.text }}>
            {rangeText(value)}
          </Text>
        </View>
        <IconSymbol name="chevron.left" size={18} color={colors.textTertiary} />
      </Pressable>

      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpen(false)}
      >
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <View
            style={{
              flexDirection: "row-reverse",
              alignItems: "center",
              justifyContent: "space-between",
              gap: spacing.md,
              paddingHorizontal: spacing.lg,
              paddingTop: spacing.lg,
              paddingBottom: spacing.md,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
              backgroundColor: colors.surface,
            }}
          >
            <Text style={{ ...type.title3, ...rtlText, color: colors.text }}>اختيار فترة التقرير</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="إغلاق"
              onPress={() => setOpen(false)}
              style={({ pressed }) => ({
                width: hitSize.min,
                height: hitSize.min,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: radius.full,
                backgroundColor: colors.surfaceSunken,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <IconSymbol name="xmark" color={colors.textSecondary} size={18} />
            </Pressable>
          </View>

          <ScrollView
            contentInsetAdjustmentBehavior="automatic"
            contentContainerStyle={{
              padding: spacing.lg,
              paddingBottom: spacing.lg + insets.bottom,
              gap: spacing.lg,
            }}
          >
            <View accessibilityRole="radiogroup" style={{ gap: spacing.sm }}>
              {OPTIONS.map((option) => (
                <PeriodChoice
                  key={option.value}
                  testID={`${testIDPrefix}-preset-${option.value}`}
                  label={option.label}
                  hint={option.hint}
                  selected={draft.preset === option.value}
                  onPress={() => selectPreset(option.value)}
                />
              ))}
            </View>

            {draft.preset === "custom" ? (
              <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: spacing.sm }}>
                <DateButton
                  testID={`${testIDPrefix}-from`}
                  label="من تاريخ"
                  value={draft.from}
                  onPress={() => setPicker("from")}
                />
                <DateButton
                  testID={`${testIDPrefix}-to`}
                  label="إلى تاريخ"
                  value={draft.to}
                  onPress={() => setPicker("to")}
                />
              </View>
            ) : null}

            {picker ? (
              <DateTimePicker
                testID={`${testIDPrefix}-date-picker`}
                value={dayToDate(picker === "day" ? draft.from : draft[picker])}
                mode="date"
                locale="en_US"
                onChange={onPickerChange}
              />
            ) : null}

            <View style={{ gap: spacing.xs }}>
              <Text style={{ ...type.caption, ...rtlText, color: colors.textTertiary }}>الفترة المختارة</Text>
              <Text selectable style={{ ...type.bodyStrong, ...numeric, ...rtlText, color: colors.text }}>
                {rangeText(draft)} · توقيت الرياض
              </Text>
            </View>

            <PrimaryButton
              testID={`${testIDPrefix}-apply`}
              label="تطبيق الفترة"
              icon="checkmark.circle"
              onPress={() => {
                onChange(draft);
                setOpen(false);
              }}
            />
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}
