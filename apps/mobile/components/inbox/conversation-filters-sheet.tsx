import DateTimePicker from "@react-native-community/datetimepicker";
import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ActionBar, PrimaryButton } from "@/components/primary-button";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { hitSize, radius, rtlText, spacing, type } from "@/constants/theme";
import { bookingStageLabel, contactOutcomeLabel, csStatusLabel } from "@/lib/format";
import { tapFeedback } from "@/lib/haptics";
import { useTheme } from "@/providers/theme-provider";
import type {
  BookingStage,
  ContactOutcome,
  ConversationFilters,
  ConversationHandling,
  ConversationLabel,
  ConversationSection,
  CsStatus,
} from "@/types/api";

const STATUS_ORDER: CsStatus[] = ["open", "waiting", "resolved"];
const OUTCOME_ORDER: ContactOutcome[] = ["booked", "not_booked", "no_reply"];
const SECTION_LABEL: Record<ConversationSection, string> = {
  orders: "قسم الطلبات",
  replies: "قسم الردود",
  complaints: "قسم الشكاوى",
};
const SECTION_ORDER: ConversationSection[] = ["orders", "replies", "complaints"];
const RIYADH_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Riyadh",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const ARABIC_WEEKDAY = new Intl.DateTimeFormat("ar-SA", {
  timeZone: "Asia/Riyadh",
  weekday: "long",
});

function dateFromRiyadhDay(day: string | null): Date {
  return day && /^\d{4}-\d{2}-\d{2}$/.test(day)
    ? new Date(`${day}T12:00:00+03:00`)
    : new Date();
}

export function conversationDateLabel(day: string): string {
  const date = dateFromRiyadhDay(day);
  return RIYADH_DATE.format(date) === RIYADH_DATE.format(new Date())
    ? "محادثات اليوم"
    : `محادثات ${ARABIC_WEEKDAY.format(date)}`;
}
/** The booking's own progression, in the order the owner works through it. */
const STAGE_ORDER: BookingStage[] = [
  "collecting_details",
  "awaiting_confirmation",
  "booking_confirmed",
  "invoice_required",
  "in_progress",
  "completed",
];

/**
 * Who has actually dealt with the thread — the axis none of the tabs cover.
 * "مقروءة بدون استلام" is the one the owner keeps asking for: somebody opened
 * the chat, so it left the جديد tab, and then nobody took it.
 */
const HANDLING_ORDER: ConversationHandling[] = [
  "whatsapp",
  "unread",
  "read_unclaimed",
];
export const HANDLING_LABEL: Record<ConversationHandling, string> = {
  whatsapp: "تم الرد من واتساب",
  unread: "غير مقروءة",
  read_unclaimed: "مقروءة بدون استلام",
};

/** How many refinements are on — drives the badge on the inbox's filter button. */
export function activeFilterCount(filters: ConversationFilters): number {
  return (
    (filters.status ? 1 : 0) +
    (filters.contactOutcome ? 1 : 0) +
    (filters.section ? 1 : 0) +
    (filters.labelId ? 1 : 0) +
    (filters.bookingStage ? 1 : 0) +
    (filters.handling ? 1 : 0) +
    (filters.date ? 1 : 0)
  );
}

function Choice({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={() => {
        tapFeedback();
        onPress();
      }}
      style={({ pressed }) => ({
        flexDirection: "row-reverse",
        alignItems: "center",
        gap: spacing.xs,
        minHeight: hitSize.min,
        paddingHorizontal: spacing.md + 2,
        borderRadius: radius.full,
        borderWidth: selected ? 1.5 : 1,
        borderColor: selected ? colors.brand : colors.border,
        backgroundColor: selected
          ? colors.brandSoft
          : pressed
            ? colors.surfaceSunken
            : colors.surface,
      })}
    >
      {selected ? <IconSymbol name="checkmark" color={colors.brand} size={14} /> : null}
      <Text
        style={{
          ...type.subhead,
          fontWeight: selected ? "700" : "400",
          color: selected ? colors.onBrandSoft : colors.textSecondary,
          ...rtlText,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={{ ...type.subheadStrong, color: colors.text, ...rtlText }}>{title}</Text>
      <View
        style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: spacing.sm }}
      >
        {children}
      </View>
    </View>
  );
}

/**
 * The refinements the web inbox keeps in dropdowns beside its view tabs —
 * status, section, label — in the one place a phone has room for them.
 *
 * They narrow whichever view is open rather than replacing it, so the tab
 * counts keep answering "how many are in this view" while the list answers
 * "how many of those match".
 */
export function ConversationFiltersSheet({
  open,
  filters,
  labels,
  onClose,
  onChange,
}: {
  open: boolean;
  filters: ConversationFilters;
  labels: ConversationLabel[];
  onClose: () => void;
  onChange: (filters: ConversationFilters) => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const recentDays = useMemo(
    () =>
      Array.from({ length: 7 }, (_, offset) => {
        const date = new Date();
        date.setDate(date.getDate() - offset);
        const value = RIYADH_DATE.format(date);
        return { value, label: conversationDateLabel(value) };
      }),
    [],
  );

  return (
    <Modal
      visible={open}
      onRequestClose={onClose}
      animationType="slide"
      presentationStyle="pageSheet"
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
          <Text style={{ ...type.title3, color: colors.text, ...rtlText }}>تصفية</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="إغلاق"
            onPress={onClose}
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
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl }}
        >
          <Group title="حالة المحادثة">
            <Choice
              label="كل الحالات"
              selected={!filters.status}
              onPress={() => onChange({ ...filters, status: null })}
            />
            {STATUS_ORDER.map((status) => (
              <Choice
                key={status}
                label={csStatusLabel[status]}
                selected={filters.status === status}
                onPress={() => onChange({ ...filters, status })}
              />
            ))}
          </Group>

          <Group title="نتيجة التواصل">
            <Choice
              label="كل النتائج"
              selected={!filters.contactOutcome}
              onPress={() => onChange({ ...filters, contactOutcome: null })}
            />
            {OUTCOME_ORDER.map((outcome) => (
              <Choice
                key={outcome}
                label={contactOutcomeLabel[outcome]}
                selected={filters.contactOutcome === outcome}
                onPress={() => onChange({ ...filters, contactOutcome: outcome })}
              />
            ))}
          </Group>

          <Group title="المتابعة">
            <Choice
              label="كل المحادثات"
              selected={!filters.handling}
              onPress={() => onChange({ ...filters, handling: null })}
            />
            {HANDLING_ORDER.map((handling) => (
              <Choice
                key={handling}
                label={HANDLING_LABEL[handling]}
                selected={filters.handling === handling}
                onPress={() => onChange({ ...filters, handling })}
              />
            ))}
          </Group>

          <Group title="القسم">
            <Choice
              label="كل الأقسام"
              selected={!filters.section}
              onPress={() => onChange({ ...filters, section: null })}
            />
            {SECTION_ORDER.map((section) => (
              <Choice
                key={section}
                label={SECTION_LABEL[section]}
                selected={filters.section === section}
                onPress={() => onChange({ ...filters, section })}
              />
            ))}
          </Group>

          <Group title="تاريخ المحادثة">
            <Choice
              label="كل التواريخ"
              selected={!filters.date}
              onPress={() => onChange({ ...filters, date: null })}
            />
            {recentDays.map((day) => (
              <Choice
                key={day.value}
                label={day.label}
                selected={filters.date === day.value}
                onPress={() => onChange({ ...filters, date: day.value })}
              />
            ))}
            <Choice
              label={
                filters.date && !recentDays.some((day) => day.value === filters.date)
                  ? `التاريخ: ${filters.date}`
                  : "اختيار تاريخ آخر"
              }
              selected={
                Boolean(filters.date) &&
                !recentDays.some((day) => day.value === filters.date)
              }
              onPress={() => setDatePickerOpen(true)}
            />
          </Group>

          {datePickerOpen ? (
            <DateTimePicker
              value={dateFromRiyadhDay(filters.date)}
              mode="date"
              maximumDate={new Date()}
              display={process.env.EXPO_OS === "ios" ? "inline" : "default"}
              onChange={(event, date) => {
                if (process.env.EXPO_OS === "android") setDatePickerOpen(false);
                if (event.type === "set" && date) {
                  onChange({ ...filters, date: RIYADH_DATE.format(date) });
                }
              }}
            />
          ) : null}

          <Group title="مرحلة متابعة الحجز">
            <Choice
              label="كل المراحل"
              selected={!filters.bookingStage}
              onPress={() => onChange({ ...filters, bookingStage: null })}
            />
            {STAGE_ORDER.map((stage) => (
              <Choice
                key={stage}
                label={bookingStageLabel[stage]}
                selected={filters.bookingStage === stage}
                onPress={() => onChange({ ...filters, bookingStage: stage })}
              />
            ))}
          </Group>

          {labels.length ? (
            <Group title="التصنيف">
              <Choice
                label="كل التصنيفات"
                selected={!filters.labelId}
                onPress={() => onChange({ ...filters, labelId: null })}
              />
              {labels.map((label) => (
                <Choice
                  key={label.id}
                  label={label.name}
                  selected={filters.labelId === label.id}
                  onPress={() => onChange({ ...filters, labelId: label.id })}
                />
              ))}
            </Group>
          ) : null}
        </ScrollView>

        <ActionBar bottomInset={insets.bottom}>
          <PrimaryButton label="عرض النتائج" icon="checkmark" onPress={onClose} />
          <PrimaryButton
            label="مسح التصفية"
            variant="plain"
            silent
            disabled={activeFilterCount(filters) === 0}
            onPress={() =>
              onChange({
                status: null,
                contactOutcome: null,
                section: null,
                labelId: null,
                bookingStage: null,
                handling: null,
                date: null,
              })
            }
          />
        </ActionBar>
      </View>
    </Modal>
  );
}
