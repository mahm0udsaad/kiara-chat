import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";

import { InlineAlert } from "@/components/screen-state";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { hitSize, numeric, radius, rtlText, spacing, type } from "@/constants/theme";
import { bookingStageLabel, contactOutcomeLabel, csStatusLabel } from "@/lib/format";
import { tapFeedback } from "@/lib/haptics";
import { useCampaignAudience } from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";
import type {
  BookingStage,
  CampaignAudienceFilters,
  ContactOutcome,
  CsStatus,
} from "@/types/api";

const STATUS_ORDER: CsStatus[] = ["open", "waiting", "resolved"];
const OUTCOME_ORDER: ContactOutcome[] = ["booked", "not_booked", "no_reply"];
const STAGE_ORDER: BookingStage[] = [
  "collecting_details",
  "awaiting_confirmation",
  "booking_confirmed",
  "invoice_required",
  "in_progress",
  "completed",
];

/**
 * How many rows are drawn at once.
 *
 * The list is plain Views inside the sheet's own ScrollView — a virtualized
 * list nested in a scroll view fights it for gestures and warns. A thousand
 * women were never pickable by scrolling anyway; the filters and the search
 * are how an employee gets to the handful she means.
 */
const VISIBLE_ROWS = 60;

function Chip({
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
      accessibilityState={{ selected }}
      onPress={() => {
        tapFeedback();
        onPress();
      }}
      style={{
        minHeight: hitSize.min - 10,
        justifyContent: "center",
        paddingHorizontal: spacing.md,
        borderRadius: radius.full,
        borderWidth: 1,
        borderColor: selected ? colors.brand : colors.border,
        backgroundColor: selected ? colors.surfaceSunken : colors.surface,
      }}
    >
      <Text
        style={{
          ...type.caption,
          ...rtlText,
          color: selected ? colors.brand : colors.textSecondary,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function FilterRow({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={{ ...type.caption, color: colors.textTertiary, ...rtlText }}>{title}</Text>
      <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: spacing.xs }}>
        {children}
      </View>
    </View>
  );
}

/**
 * Pick the audience by hand, with the inbox's own filters.
 *
 * The segment above narrows by booking recency; these narrow by what the inbox
 * knows — label, conversation status, booking stage, contact outcome — so the
 * women a campaign is actually meant for can be found the same way the chat
 * list is read, and ticked one by one.
 *
 * Ticking nobody keeps the old behaviour: the whole segment goes.
 *
 * One limit worth knowing: the conversation filters only match women who have
 * a chat in Kiara. The rest came from the Rekaz import and are reachable by
 * segment and by search.
 */
export function CampaignAudience({
  contentSid,
  segment,
  selected,
  onChange,
}: {
  contentSid: string | null;
  segment: string;
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const { colors } = useTheme();
  const [filters, setFilters] = useState<CampaignAudienceFilters>({
    labelId: null,
    status: null,
    bookingStage: null,
    contactOutcome: null,
    search: "",
    includeSent: false,
  });
  // The field keeps every keystroke; the query only sees the settled value, so
  // typing a number does not fire a scan of the whole customer list per letter.
  const [typed, setTyped] = useState("");
  useEffect(() => {
    const timer = setTimeout(
      () => setFilters((current) => ({ ...current, search: typed })),
      300,
    );
    return () => clearTimeout(timer);
  }, [typed]);

  const audience = useCampaignAudience({ contentSid, segment, filters });
  const members = useMemo(() => audience.data?.members ?? [], [audience.data]);
  const labels = audience.data?.labels ?? [];
  const chosen = useMemo(() => new Set(selected), [selected]);
  const shown = members.slice(0, VISIBLE_ROWS);
  const hidden = Math.max(0, members.length - shown.length);

  const toggle = (id: string) => {
    tapFeedback();
    onChange(
      chosen.has(id) ? selected.filter((value) => value !== id) : [...selected, id],
    );
  };

  const set = (patch: Partial<CampaignAudienceFilters>) =>
    setFilters((current) => ({ ...current, ...patch }));

  if (!contentSid) {
    return (
      <Text style={{ ...type.caption, color: colors.textTertiary, ...rtlText }}>
        اختاري القالب أولًا لعرض العميلات.
      </Text>
    );
  }

  return (
    <View style={{ gap: spacing.md }}>
      <View
        style={{
          flexDirection: "row-reverse",
          alignItems: "center",
          gap: spacing.sm,
          paddingHorizontal: spacing.md,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
        }}
      >
        <IconSymbol name="magnifyingglass" color={colors.textTertiary} size={16} />
        <TextInput
          value={typed}
          onChangeText={setTyped}
          placeholder="ابحثي بالاسم أو الرقم"
          placeholderTextColor={colors.textTertiary}
          keyboardType="default"
          returnKeyType="search"
          style={{
            flex: 1,
            minHeight: hitSize.min - 8,
            ...type.body,
            color: colors.text,
            textAlign: "right",
          }}
        />
        {typed ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="مسح البحث"
            onPress={() => setTyped("")}
          >
            <IconSymbol name="xmark.circle" color={colors.textTertiary} size={16} />
          </Pressable>
        ) : null}
      </View>

      {labels.length ? (
        <FilterRow title="التصنيف">
          {labels.map((label) => (
            <Chip
              key={label.id}
              label={label.name}
              selected={filters.labelId === label.id}
              onPress={() =>
                set({ labelId: filters.labelId === label.id ? null : label.id })
              }
            />
          ))}
        </FilterRow>
      ) : null}

      <FilterRow title="حالة المحادثة">
        {STATUS_ORDER.map((status) => (
          <Chip
            key={status}
            label={csStatusLabel[status]}
            selected={filters.status === status}
            onPress={() => set({ status: filters.status === status ? null : status })}
          />
        ))}
      </FilterRow>

      <FilterRow title="مرحلة الحجز">
        {STAGE_ORDER.map((stage) => (
          <Chip
            key={stage}
            label={bookingStageLabel[stage]}
            selected={filters.bookingStage === stage}
            onPress={() =>
              set({ bookingStage: filters.bookingStage === stage ? null : stage })
            }
          />
        ))}
      </FilterRow>

      <FilterRow title="نتيجة التواصل">
        {OUTCOME_ORDER.map((outcome) => (
          <Chip
            key={outcome}
            label={contactOutcomeLabel[outcome]}
            selected={filters.contactOutcome === outcome}
            onPress={() =>
              set({
                contactOutcome: filters.contactOutcome === outcome ? null : outcome,
              })
            }
          />
        ))}
      </FilterRow>

      <FilterRow title="من سبق إرسال القالب لها">
        <Chip
          label={filters.includeSent ? "تظهر في القائمة" : "مستبعدة"}
          selected={filters.includeSent}
          onPress={() => set({ includeSent: !filters.includeSent })}
        />
      </FilterRow>

      <View
        style={{
          flexDirection: "row-reverse",
          alignItems: "center",
          justifyContent: "space-between",
          gap: spacing.sm,
        }}
      >
        <Text style={{ ...type.caption, ...numeric, color: colors.textSecondary, ...rtlText }}>
          {audience.isPending
            ? "جارٍ الحساب…"
            : selected.length
              ? `${selected.length} مختارة من ${members.length}`
              : `${members.length} عميلة — سيُرسل للفئة كاملة`}
        </Text>
        <View style={{ flexDirection: "row-reverse", gap: spacing.sm }}>
          {shown.length ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                tapFeedback();
                const ids = shown.map((member) => member.id);
                const missing = ids.filter((id) => !chosen.has(id));
                // Adds the visible rows, or clears exactly them when they are
                // already all ticked — never touches a selection made under a
                // different filter.
                onChange(
                  missing.length
                    ? [...selected, ...missing]
                    : selected.filter((id) => !ids.includes(id)),
                );
              }}
            >
              <Text style={{ ...type.caption, color: colors.brand }}>
                {shown.every((member) => chosen.has(member.id))
                  ? "إلغاء الظاهر"
                  : "تحديد الظاهر"}
              </Text>
            </Pressable>
          ) : null}
          {selected.length ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                tapFeedback();
                onChange([]);
              }}
            >
              <Text style={{ ...type.caption, color: colors.danger }}>مسح التحديد</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {audience.isPending ? (
        <View style={{ paddingVertical: spacing.lg, alignItems: "center" }}>
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : audience.error ? (
        <InlineAlert message={(audience.error as Error).message} />
      ) : !members.length ? (
        <Text style={{ ...type.caption, color: colors.textTertiary, ...rtlText }}>
          لا توجد عميلة بهذه الشروط. وسّعي الفلاتر أو امسحي البحث.
        </Text>
      ) : (
        <View
          style={{
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: colors.border,
            overflow: "hidden",
          }}
        >
          {shown.map((member, index) => {
            const on = chosen.has(member.id);
            return (
              <Pressable
                key={member.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={member.name || member.phone}
                onPress={() => toggle(member.id)}
                style={{
                  flexDirection: "row-reverse",
                  alignItems: "center",
                  gap: spacing.sm,
                  minHeight: hitSize.min,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.sm,
                  borderTopWidth: index === 0 ? 0 : 1,
                  borderTopColor: colors.border,
                  backgroundColor: on ? colors.surfaceSunken : colors.surface,
                }}
              >
                <IconSymbol
                  name={on ? "checkmark.circle" : "person.crop.circle"}
                  color={on ? colors.brand : colors.textTertiary}
                  size={20}
                />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text
                    numberOfLines={1}
                    style={{ ...type.body, color: colors.text, ...rtlText }}
                  >
                    {member.name?.trim() || "بدون اسم"}
                  </Text>
                  <Text
                    style={{
                      ...type.caption,
                      ...numeric,
                      color: colors.textTertiary,
                      writingDirection: "ltr",
                      textAlign: "left",
                    }}
                  >
                    {member.phone}
                  </Text>
                </View>
                {member.state === "sent" ? (
                  <Text style={{ ...type.caption, color: colors.textTertiary }}>سبق الإرسال</Text>
                ) : member.csStatus ? (
                  <Text style={{ ...type.caption, color: colors.textTertiary }}>
                    {csStatusLabel[member.csStatus]}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      )}

      {hidden ? (
        <Text style={{ ...type.caption, ...numeric, color: colors.textTertiary, ...rtlText }}>
          تظهر أول {VISIBLE_ROWS} عميلة، وهناك {hidden} غيرهن. ضيّقي بالبحث أو
          بالفلاتر للوصول إليهن — أو اتركي التحديد فارغًا ليصل الاستهداف للفئة كاملة.
        </Text>
      ) : null}
    </View>
  );
}
