import { Link, Stack, useRouter } from "expo-router";
import { memo, useCallback, useDeferredValue, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";

import { ApiError } from "@/lib/api";
import { ScheduleGrid } from "@/components/orders/schedule-grid";
import { EmptyState, ErrorState } from "@/components/screen-state";
import { Badge } from "@/components/ui/badge";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { Segmented, type SegmentOption } from "@/components/ui/segmented";
import { SkeletonList } from "@/components/ui/skeleton";
import { hitSize, radius, rtlText, spacing, type } from "@/constants/theme";
import {
  addDays,
  buildDaySchedule,
  dayKeyFromToday,
  dayKeyOf,
  mergeVisits,
  visitMatchesFilter,
  visitMatchesSearch,
  type CalendarVisit,
  type VisitFilter,
} from "@/lib/calendar";
import {
  executionIsStalled,
  executionStateOf,
  ROLE_LABEL,
  stalledLabel,
} from "@/lib/execution";
import {
  durationLabel,
  formatters,
  orderStatusIcon,
  orderStatusLabel,
  orderStatusTone,
  relativeDayLabel,
} from "@/lib/format";
import { tapFeedback } from "@/lib/haptics";
import {
  useCreateOrderFromReservation,
  useOrdersCalendar,
  useRekazCheck,
  useRekazPull,
} from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";

/** How far the day strip scrolls in each direction. */
const STRIP_BACK = 7;
const STRIP_AHEAD = 30;
const DAY_CHIP_WIDTH = 62;

const filters: SegmentOption<VisitFilter>[] = [
  { value: "all", label: "الكل" },
  { value: "today", label: "اليوم" },
  { value: "needs_driver", label: "بحاجة إلى تعيين" },
  { value: "driver_requested", label: "تم طلب سائق" },
  { value: "exception", label: "استثناءات" },
];

const keyOfVisit = (visit: CalendarVisit) => visit.key;

type OrdersView = "list" | "grid";

/**
 * The agenda answers "what is next"; the grid answers "who is where at 11".
 * Both read the same day, so the toggle carries no other state.
 */
const views: SegmentOption<OrdersView>[] = [
  { value: "list", label: "قائمة" },
  { value: "grid", label: "جدول" },
];

const weekdayFormatter = new Intl.DateTimeFormat("ar-EG", { weekday: "short" });
const dayNumberFormatter = new Intl.DateTimeFormat("ar-EG", { day: "numeric" });

function dayChipDate(dayKey: string) {
  return new Date(`${dayKey}T12:00:00Z`);
}

/**
 * Horizontal day strip. The selected day is the screen's single piece of
 * navigation state, and it survives a refetch so an employee reading Thursday
 * is never thrown back to today by a background poll.
 */
function DayStrip({
  days,
  selected,
  onSelect,
  countsByDay,
}: {
  days: string[];
  selected: string;
  onSelect: (day: string) => void;
  countsByDay: Map<string, number>;
}) {
  const { colors } = useTheme();
  const listRef = useRef<FlatList<string>>(null);
  const todayKey = dayKeyFromToday(0);

  return (
    <FlatList
      ref={listRef}
      horizontal
      inverted
      data={days}
      keyExtractor={(day) => day}
      showsHorizontalScrollIndicator={false}
      initialScrollIndex={Math.max(days.indexOf(selected), 0)}
      getItemLayout={(_, index) => ({
        length: DAY_CHIP_WIDTH + spacing.sm,
        offset: (DAY_CHIP_WIDTH + spacing.sm) * index,
        index,
      })}
      contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.lg }}
      renderItem={({ item: day }) => {
        const active = day === selected;
        const isToday = day === todayKey;
        const count = countsByDay.get(day) ?? 0;
        const date = dayChipDate(day);
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${formatters.weekdayDate.format(date)}، ${
              count ? `${count} زيارة` : "لا زيارات"
            }`}
            onPress={() => onSelect(day)}
            style={{
              width: DAY_CHIP_WIDTH,
              minHeight: hitSize.comfortable + 12,
              paddingVertical: spacing.sm,
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
              borderRadius: radius.lg,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: active
                ? colors.brand
                : isToday
                  ? colors.borderStrong
                  : colors.border,
              backgroundColor: active ? colors.brand : colors.surface,
            }}
          >
            <Text
              style={{
                ...type.caption,
                color: active ? colors.onBrand : colors.textTertiary,
              }}
            >
              {weekdayFormatter.format(date)}
            </Text>
            <Text
              style={{
                ...type.headline,
                color: active ? colors.onBrand : colors.text,
                fontVariant: ["tabular-nums"],
              }}
            >
              {dayNumberFormatter.format(date)}
            </Text>
            {/* Load is shown as a dot, not a number: the strip is for choosing
                a day, and a count here competes with the agenda itself. */}
            <View
              style={{
                width: 5,
                height: 5,
                borderRadius: radius.full,
                backgroundColor: count
                  ? active
                    ? colors.onBrand
                    : colors.brand
                  : "transparent",
              }}
            />
          </Pressable>
        );
      }}
    />
  );
}

/**
 * The Rekaz pending-change banner.
 *
 * `سحب الآن` applies the delta under the tenant lock and reports what actually
 * landed, so the count on screen is never a promise the pull does not keep.
 */
function RekazBanner({ selectedDayVisible }: { selectedDayVisible: boolean }) {
  const { colors } = useTheme();
  const check = useRekazCheck({ enabled: selectedDayVisible });
  const pull = useRekazPull();

  const pending = check.data?.preview.pending ?? 0;
  const failed = check.isError;
  // Rekaz closed anonymous reads in Aug 2026: the salon account has to be
  // connected on the server. That is an admin task, not something the employee
  // on the floor can retry her way out of, so it gets its own wording and no
  // pull button.
  const needsReconnect =
    check.error instanceof ApiError && check.error.code === "REKAZ_AUTH_REQUIRED";

  if (!failed && pending === 0 && !pull.isPending) return null;

  const detail = check.data
    ? `${check.data.preview.added} جديدة · ${check.data.preview.updated} معدّلة · ${check.data.preview.removed} ملغاة`
    : "";

  return (
    <View
      style={{
        gap: spacing.sm,
        padding: spacing.md,
        borderRadius: radius.lg,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: failed ? colors.danger : colors.borderStrong,
        backgroundColor: failed ? colors.dangerSoft : colors.warningSoft,
      }}
    >
      <View
        style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}
      >
        <IconSymbol
          name={failed ? "exclamationmark.triangle" : "arrow.triangle.2.circlepath"}
          size={16}
          color={failed ? colors.onDangerSoft : colors.onWarningSoft}
        />
        <Text
          style={{
            flex: 1,
            ...type.subheadStrong,
            color: failed ? colors.onDangerSoft : colors.onWarningSoft,
            ...rtlText,
          }}
        >
          {failed
            ? needsReconnect
              ? (check.error?.message ?? "يحتاج ركاز إلى إعادة ربط الحساب")
              : "تعذّر فحص تحديثات ركاز"
            : `${pending} تغييرات جديدة من ركاز لم يتم سحبها`}
        </Text>
      </View>

      {!failed && detail ? (
        <Text
          style={{ ...type.footnote, color: colors.onWarningSoft, ...rtlText }}
        >
          {detail}
        </Text>
      ) : null}

      {check.data?.lastSync?.completedAt ? (
        <Text style={{ ...type.caption, color: colors.textSecondary, ...rtlText }}>
          {`آخر سحب ناجح: ${formatters.dateTime.format(
            new Date(check.data.lastSync.completedAt),
          )}`}
        </Text>
      ) : null}

      {pull.isError ? (
        <Text style={{ ...type.footnote, color: colors.onDangerSoft, ...rtlText }}>
          {pull.error.message}
        </Text>
      ) : null}
      {pull.isSuccess && !pull.isPending ? (
        <Text style={{ ...type.footnote, color: colors.onSuccessSoft, ...rtlText }}>
          {`تم السحب: ${pull.data.changes.added} جديدة · ${pull.data.changes.updated} معدّلة · ${pull.data.changes.removed} ملغاة`}
        </Text>
      ) : null}

      <View style={{ flexDirection: "row-reverse", gap: spacing.sm }}>
        {needsReconnect ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="سحب تغييرات ركاز الآن"
          disabled={pull.isPending || failed}
          onPress={() => pull.mutate()}
          style={{
            minHeight: hitSize.min,
            paddingHorizontal: spacing.lg,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: radius.md,
            backgroundColor: colors.brand,
            opacity: pull.isPending || failed ? 0.6 : 1,
          }}
        >
          {pull.isPending ? (
            <ActivityIndicator color={colors.onBrand} />
          ) : (
            <Text style={{ ...type.calloutStrong, color: colors.onBrand }}>
              سحب الآن
            </Text>
          )}
        </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="إعادة فحص تحديثات ركاز"
          onPress={() => void check.refetch()}
          style={{
            minHeight: hitSize.min,
            paddingHorizontal: spacing.lg,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.borderStrong,
          }}
        >
          <Text style={{ ...type.callout, color: colors.text }}>مراجعة</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Module-level: an inline arrow here is a brand-new component type per render. */
function VisitSeparator() {
  return <View style={{ height: spacing.md }} />;
}

const VisitCard = memo(function VisitCard({
  visit,
  showDay = false,
}: {
  visit: CalendarVisit;
  /** Search results leave the selected day behind, so each row names its own. */
  showDay?: boolean;
}) {
  const { colors } = useTheme();
  const router = useRouter();
  const createOrder = useCreateOrderFromReservation();
  const arrival = new Date(visit.arrivalAt);
  const order = visit.order;

  // An order already out with a driver has a second kind of trouble the
  // dispatch status cannot show: a step nobody has taken. Both colour the card.
  const execution = order ? executionStateOf(order) : null;
  const stalled = Boolean(execution && executionIsStalled(execution));
  const needsAttention =
    order?.status === "failed" ||
    order?.dispatch_state === "uncertain" ||
    stalled;

  const requestDriver = useCallback(() => {
    // Raising the order row is not the commitment — the dispatch is. So an
    // order left behind by an earlier tap that never reached the send is
    // RESUMED, not raised again: the server refuses a second order for the
    // same Rekaz visit (ORDER_ALREADY_LINKED), and the only way forward is
    // the dispatch screen the employee backed out of.
    if (order) {
      router.push({ pathname: "/orders/[id]/dispatch", params: { id: order.id } });
      return;
    }
    if (!visit.reservation) return;
    createOrder.mutate(visit.reservation.id, {
      // Creating the visit is not the commit that matters. The employee lands
      // on the dispatch confirmation, where the exact driver and specialist
      // messages are shown and editable before anything is sent.
      onSuccess: (result) =>
        router.push({
          pathname: "/orders/[id]/dispatch",
          params: { id: result.order.id },
        }),
      onError: (error) =>
        Alert.alert("تعذّر إنشاء الطلب", error.message),
    });
  }, [createOrder, order, router, visit.reservation]);

  const body = (
    <View
      style={{
        gap: spacing.sm,
        padding: spacing.lg,
        borderRadius: radius.xl,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: needsAttention ? colors.danger : colors.border,
        backgroundColor: colors.surface,
        boxShadow: "0 1px 2px rgba(24, 33, 77, 0.05)",
      }}
    >
      <View style={{ flexDirection: "row-reverse", gap: spacing.md }}>
        <View style={{ alignItems: "center", gap: 2, minWidth: 62 }}>
          {showDay ? (
            <Text
              numberOfLines={1}
              style={{ ...type.caption, color: colors.brand, ...rtlText }}
            >
              {relativeDayLabel(visit.arrivalAt)}
            </Text>
          ) : null}
          <Text
            style={{
              ...type.title3,
              color: colors.text,
              fontVariant: ["tabular-nums"],
            }}
          >
            {formatters.time.format(arrival)}
          </Text>
          {/* When several services run back to back, the finish time is what
              the next slot and the driver's return are planned around, so it
              is shown rather than left to be worked out from the duration. */}
          {visit.serviceCount > 1 ? (
            <Text
              style={{
                ...type.caption,
                fontWeight: "400",
                color: colors.textTertiary,
                fontVariant: ["tabular-nums"],
              }}
            >
              ← {formatters.time.format(new Date(visit.endsAt))}
            </Text>
          ) : null}
          <Text
            style={{ ...type.caption, fontWeight: "400", color: colors.textTertiary }}
          >
            {durationLabel(visit.durationMinutes || 0)}
          </Text>
        </View>

        <View style={{ width: 1, backgroundColor: colors.border }} />

        <View style={{ flex: 1, gap: spacing.sm }}>
          <View
            style={{
              flexDirection: "row-reverse",
              alignItems: "center",
              gap: spacing.sm,
            }}
          >
            {/* The customer's name is a button, not a label — it opens her
                record. Nested inside the card's own Pressable, so it stops the
                tap from also opening the order. */}
            <Link
              href={{
                pathname: "/customer/[phone]",
                params: { phone: visit.customerPhone, name: visit.customerName },
              }}
              asChild
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`ملف العميلة ${visit.customerName || visit.customerPhone}`}
                hitSlop={spacing.sm}
                style={{ flex: 1, minHeight: hitSize.min, justifyContent: "center" }}
                onPress={(event) => event.stopPropagation()}
              >
                <Text
                  numberOfLines={1}
                  style={{ ...type.headline, color: colors.text, ...rtlText }}
                >
                  {visit.customerName || visit.customerPhone}
                </Text>
              </Pressable>
            </Link>
            {order ? (
              <Badge
                label={orderStatusLabel[order.status]}
                tone={orderStatusTone[order.status]}
                icon={orderStatusIcon[order.status] as "clock"}
              />
            ) : (
              <Badge label="بدون طلب" tone="warning" icon="clock" />
            )}
          </View>

          {visit.services.length ? (
            <View style={{ gap: 2 }}>
              <Text
                numberOfLines={3}
                style={{ ...type.footnote, color: colors.textSecondary, ...rtlText }}
              >
                {visit.services.join(" · ")}
              </Text>
              {visit.serviceCount > 1 ? (
                <Text style={{ ...type.caption, color: colors.brand, ...rtlText }}>
                  {visit.serviceCount} خدمات في نفس الزيارة
                </Text>
              ) : null}
            </View>
          ) : null}

          {visit.location ? (
            <View
              style={{
                flexDirection: "row-reverse",
                alignItems: "flex-start",
                gap: spacing.xs + 2,
              }}
            >
              <IconSymbol
                name="mappin.and.ellipse"
                color={colors.textTertiary}
                size={14}
              />
              <Text
                numberOfLines={2}
                style={{
                  flex: 1,
                  ...type.footnote,
                  color: colors.textSecondary,
                  ...rtlText,
                }}
              >
                {visit.location}
              </Text>
            </View>
          ) : null}

          <View
            style={{
              flexDirection: "row-reverse",
              flexWrap: "wrap",
              alignItems: "center",
              gap: spacing.xs + 2,
            }}
          >
            {visit.reservation ? (
              <Badge
                label={visit.reservation.status || "ركاز"}
                tone={visit.reservation.status === "Confirmed" ? "success" : "neutral"}
              />
            ) : (
              <Badge label="بدون حجز ركاز" tone="neutral" />
            )}
            {order?.specialist_name ? (
              <Badge label={order.specialist_name} tone="brand" icon="sparkles" />
            ) : null}
            {order?.driver_name ? (
              <Badge label={order.driver_name} tone="brand" icon="car" />
            ) : null}
            {order?.dispatch_state === "processing" ? (
              <Badge label="جاري الإرسال" tone="info" icon="clock" />
            ) : null}
            {order?.dispatch_state === "uncertain" ? (
              <Badge label="يحتاج مراجعة" tone="danger" icon="exclamationmark.triangle" />
            ) : null}
            {execution?.tracked ? (
              <Badge
                label={execution.label}
                tone={stalled ? "danger" : execution.tone}
                icon={execution.stage === "completed" ? "checkmark.circle" : "clock"}
              />
            ) : null}
          </View>
        </View>
      </View>

      {/* Once a driver is on it, the card's own question stops being "who takes
          this?" and becomes "where has it got to?". That answer used to live
          nowhere the office could reach, so it gets the card's action slot. */}
      {order?.driver_id ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`متابعة تنفيذ طلب ${
            visit.customerName || visit.customerPhone
          }، ${execution?.label ?? "حالة التنفيذ"}`}
          onPress={(event) => {
            event.stopPropagation();
            tapFeedback();
            router.push({ pathname: "/orders/[id]/status", params: { id: order.id } });
          }}
          style={({ pressed }) => ({
            minHeight: hitSize.comfortable,
            flexDirection: "row-reverse",
            alignItems: "center",
            justifyContent: "center",
            gap: spacing.sm,
            borderRadius: radius.md,
            backgroundColor: stalled ? colors.dangerSoft : colors.brandSoft,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <IconSymbol
            name={stalled ? "exclamationmark.triangle" : "figure.walk"}
            size={16}
            color={stalled ? colors.onDangerSoft : colors.onBrandSoft}
          />
          <Text
            numberOfLines={1}
            style={{
              ...type.calloutStrong,
              color: stalled ? colors.onDangerSoft : colors.onBrandSoft,
              ...rtlText,
            }}
          >
            {stalled && execution?.stalledMinutes != null && execution.pendingRole
              ? `متابعة التنفيذ · ${ROLE_LABEL[execution.pendingRole]} متأخر ${stalledLabel(
                  execution.stalledMinutes,
                )}`
              : "متابعة التنفيذ وإرسال تذكير"}
          </Text>
        </Pressable>
      ) : null}

      {/* Until a driver is actually on the visit, the card keeps offering to
          put one there.
          It used to disappear the moment the order ROW existed, which made
          backing out of the dispatch screen strand the card with no action at
          all: too late for "طلب سائق", too early for "متابعة التنفيذ". The
          gate is the driver, not the row — which also covers a WhatsApp
          booking that has an order but no Rekaz reservation behind it. */}
      {!order?.driver_id && (order || visit.reservation) ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`طلب سائق لزيارة ${visit.customerName || visit.customerPhone}`}
          disabled={createOrder.isPending}
          onPress={(event) => {
            // The whole card is a link once an order exists; this tap is the
            // button's, not the card's.
            event.stopPropagation();
            tapFeedback();
            requestDriver();
          }}
          style={{
            minHeight: hitSize.comfortable,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: radius.md,
            backgroundColor: colors.brandSoft,
            opacity: createOrder.isPending ? 0.6 : 1,
          }}
        >
          {createOrder.isPending ? (
            <ActivityIndicator color={colors.onBrandSoft} />
          ) : (
            <Text style={{ ...type.calloutStrong, color: colors.onBrandSoft }}>
              طلب سائق
            </Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );

  if (!order) return body;
  return (
    <Link href={{ pathname: "/orders/[id]", params: { id: order.id } }} asChild>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`طلب ${visit.customerName || visit.customerPhone}، ${
          orderStatusLabel[order.status]
        }، ${formatters.time.format(arrival)}`}
      >
        {body}
      </Pressable>
    </Link>
  );
});

export default function OrdersScreen() {
  const { colors } = useTheme();
  const todayKey = dayKeyFromToday(0);
  const [selectedDay, setSelectedDay] = useState(todayKey);
  const [filter, setFilter] = useState<VisitFilter>("all");
  const [view, setView] = useState<OrdersView>("list");
  const [search, setSearch] = useState("");
  // Keeps typing responsive — the list re-filters a frame behind the keystroke.
  const deferredSearch = useDeferredValue(search);
  const query = deferredSearch.trim();
  const searching = query.length > 0;

  const days = useMemo(
    () =>
      Array.from(
        { length: STRIP_BACK + STRIP_AHEAD + 1 },
        (_, index) => dayKeyFromToday(index - STRIP_BACK),
      ),
    [todayKey], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // One bounded range around the selected day. Fetching the neighbours in the
  // same request is what makes moving a day forward feel instant instead of
  // showing a spinner on every tap.
  const from = useMemo(() => addDays(selectedDay, -3), [selectedDay]);
  const to = useMemo(() => addDays(selectedDay, 7), [selectedDay]);
  const calendar = useOrdersCalendar(from, to);

  const visits = useMemo(
    () =>
      mergeVisits(
        calendar.data?.reservations ?? [],
        calendar.data?.orders ?? [],
      ),
    [calendar.data],
  );

  const countsByDay = useMemo(() => {
    const counts = new Map<string, number>();
    for (const visit of visits) {
      const key = dayKeyOf(visit.arrivalAt);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [visits]);

  /**
   * What the tabs and their counts are computed over.
   *
   * Normally the selected day — the strip is this screen's navigation. A
   * search deliberately leaves that behind and looks across the whole loaded
   * window: an employee typing a customer's number wants to find her visit,
   * and "nothing today" is not an answer when it is booked for Thursday. Each
   * row names its own day while the box is open.
   */
  const scopedVisits = useMemo(
    () =>
      searching
        ? visits.filter((visit) => visitMatchesSearch(visit, query))
        : visits.filter((visit) => dayKeyOf(visit.arrivalAt) === selectedDay),
    [visits, searching, query, selectedDay],
  );

  const listVisits = useMemo(
    () =>
      scopedVisits.filter((visit) => visitMatchesFilter(visit, filter, todayKey)),
    [scopedVisits, filter, todayKey],
  );

  // Every tab's number stays exactly how many rows tapping it would show, the
  // query included — a count that ignored the search sends her to an empty list.
  const counts = useMemo(
    () =>
      ({
        all: scopedVisits.length,
        today: scopedVisits.filter((visit) =>
          visitMatchesFilter(visit, "today", todayKey),
        ).length,
        needs_driver: scopedVisits.filter((visit) =>
          visitMatchesFilter(visit, "needs_driver", todayKey),
        ).length,
        driver_requested: scopedVisits.filter((visit) =>
          visitMatchesFilter(visit, "driver_requested", todayKey),
        ).length,
        exception: scopedVisits.filter((visit) =>
          visitMatchesFilter(visit, "exception", todayKey),
        ).length,
      }) satisfies Record<VisitFilter, number>,
    [scopedVisits, todayKey],
  );

  /**
   * One card per service, in its specialist's column.
   *
   * Built from the reservations rather than from `visits` on purpose: the
   * merge that makes the agenda readable is exactly what the grid must undo,
   * since two specialists working the same customer at the same hour need a
   * column each.
   */
  const schedule = useMemo(
    () =>
      buildDaySchedule(
        calendar.data?.reservations ?? [],
        calendar.data?.orders ?? [],
        selectedDay,
      ),
    [calendar.data, selectedDay],
  );

  // A search looks across the whole window, which the grid — a single day —
  // cannot show; it steps aside rather than answering the wrong question.
  const gridView = view === "grid" && !searching;
  const showSkeleton = calendar.isLoading && visits.length === 0;
  const selectedDate = dayChipDate(selectedDay);

  // Hoisted so the memo on VisitCard holds; `searching` is the only thing the
  // row reads from this screen, so it is the only dependency.
  const renderVisit = useCallback(
    ({ item }: { item: CalendarVisit }) => (
      <VisitCard visit={item} showDay={searching} />
    ),
    [searching],
  );

  return (
    <>
      <Stack.Screen
        options={{
          headerSearchBarOptions: {
            placeholder: "بحث بالاسم أو رقم الجوال",
            onChangeText: (event) => setSearch(event.nativeEvent.text),
            onClose: () => setSearch(""),
            hideWhenScrolling: false,
          },
          headerRight: () =>
            selectedDay === todayKey ? null : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="العودة إلى اليوم"
                onPress={() => setSelectedDay(todayKey)}
                style={{ minHeight: hitSize.min, justifyContent: "center" }}
              >
                <Text style={{ ...type.callout, color: colors.brand }}>اليوم</Text>
              </Pressable>
            ),
        }}
      />

      <View style={{ flex: 1 }}>
        <View style={{ paddingVertical: spacing.md, gap: spacing.md }}>
          {/* The strip picks a day; a search is not about one, so it steps
              aside rather than leaving a highlighted day that means nothing. */}
          {searching ? null : (
            <DayStrip
              days={days}
              selected={selectedDay}
              onSelect={setSelectedDay}
              countsByDay={countsByDay}
            />
          )}
          <View
            style={{
              flexDirection: "row-reverse",
              alignItems: "center",
              justifyContent: "space-between",
              gap: spacing.md,
              paddingHorizontal: spacing.lg,
            }}
          >
            <Text
              style={{
                ...type.subheadStrong,
                color: colors.textSecondary,
                flexShrink: 1,
                ...rtlText,
              }}
            >
              {searching
                ? `نتائج البحث · ${formatters.shortDate.format(
                    dayChipDate(from),
                  )} إلى ${formatters.shortDate.format(dayChipDate(to))}`
                : formatters.weekdayDate.format(selectedDate)}
            </Text>
            {searching ? null : (
              <View style={{ width: 150 }}>
                <Segmented
                  accessibilityLabel="طريقة عرض اليوم"
                  options={views}
                  value={view}
                  onChange={setView}
                />
              </View>
            )}
          </View>
        </View>

        {gridView ? (
          calendar.isError ? (
            <ErrorState
              message={calendar.error.message}
              onRetry={() => void calendar.refetch()}
            />
          ) : schedule.slots.length === 0 ? (
            <EmptyState
              icon="calendar"
              title="لا توجد حجوزات في هذا اليوم"
              detail="اختاري يومًا آخر من الشريط، أو اسحبي تحديثات ركاز من القائمة."
            />
          ) : (
            <ScheduleGrid schedule={schedule} dayKey={selectedDay} />
          )
        ) : (
        <FlatList
          contentInsetAdjustmentBehavior="automatic"
          data={listVisits}
          keyExtractor={keyOfVisit}
          renderItem={renderVisit}
          initialNumToRender={6}
          maxToRenderPerBatch={6}
          windowSize={7}
          removeClippedSubviews={process.env.EXPO_OS === "android"}
          contentContainerStyle={{
            paddingHorizontal: spacing.lg,
            paddingBottom: spacing["3xl"],
            flexGrow: 1,
          }}
          ItemSeparatorComponent={VisitSeparator}
          ListHeaderComponent={
            <View style={{ gap: spacing.md, paddingBottom: spacing.md }}>
              <RekazBanner selectedDayVisible />
              <Segmented
                layout="scroll"
                accessibilityLabel={
                  searching ? "تصفية نتائج البحث" : "تصفية زيارات اليوم"
                }
                options={filters.map((option) => ({
                  ...option,
                  count: counts[option.value],
                }))}
                value={filter}
                onChange={setFilter}
              />
              {showSkeleton ? <SkeletonList count={4} /> : null}
            </View>
          }
          ListEmptyComponent={
            showSkeleton ? null : calendar.isError ? (
              <ErrorState
                message={calendar.error.message}
                onRetry={() => void calendar.refetch()}
              />
            ) : searching ? (
              // Naming the window is the point: the search covered what is
              // loaded, not the whole calendar, and a visit further out is a
              // real possibility rather than a bug she should chase.
              <EmptyState
                icon="magnifyingglass"
                title="لا توجد زيارات مطابقة"
                detail={`البحث يشمل الفترة من ${formatters.shortDate.format(
                  dayChipDate(from),
                )} إلى ${formatters.shortDate.format(
                  dayChipDate(to),
                )}. اختاري يومًا أبعد من الشريط لتوسيع النطاق.`}
                action={
                  filter === "all"
                    ? undefined
                    : { label: "عرض الكل", onPress: () => setFilter("all") }
                }
              />
            ) : filter !== "all" ? (
              <EmptyState
                icon="calendar"
                title="لا توجد زيارات بهذا الفلتر"
                detail="جرّبي عرض كل زيارات اليوم."
                action={{ label: "عرض الكل", onPress: () => setFilter("all") }}
              />
            ) : (
              <EmptyState
                icon="calendar"
                title="لا توجد زيارات في هذا اليوم"
                detail="اختاري يومًا آخر من الشريط، أو اسحبي تحديثات ركاز."
              />
            )
          }
          refreshControl={
            <RefreshControl
              refreshing={calendar.isRefetching}
              onRefresh={() => void calendar.refetch()}
              tintColor={colors.brand}
            />
          }
        />
        )}
      </View>
    </>
  );
}
