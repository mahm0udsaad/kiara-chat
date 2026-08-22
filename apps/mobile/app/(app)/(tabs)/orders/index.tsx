import { Link, Stack, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
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
import { EmptyState, ErrorState } from "@/components/screen-state";
import { Badge } from "@/components/ui/badge";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { Segmented, type SegmentOption } from "@/components/ui/segmented";
import { SkeletonList } from "@/components/ui/skeleton";
import { hitSize, radius, rtlText, spacing, type } from "@/constants/theme";
import {
  addDays,
  dayKeyFromToday,
  dayKeyOf,
  mergeVisits,
  visitMatchesFilter,
  type CalendarVisit,
  type VisitFilter,
} from "@/lib/calendar";
import {
  durationLabel,
  formatters,
  orderStatusIcon,
  orderStatusLabel,
  orderStatusTone,
} from "@/lib/format";
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
  { value: "exception", label: "استثناءات" },
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

function VisitCard({ visit }: { visit: CalendarVisit }) {
  const { colors } = useTheme();
  const router = useRouter();
  const createOrder = useCreateOrderFromReservation();
  const arrival = new Date(visit.arrivalAt);
  const order = visit.order;

  const needsAttention =
    order?.status === "failed" || order?.dispatch_state === "uncertain";

  const requestDriver = useCallback(() => {
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
  }, [createOrder, router, visit.reservation]);

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
          <Text
            style={{
              ...type.title3,
              color: colors.text,
              fontVariant: ["tabular-nums"],
            }}
          >
            {formatters.time.format(arrival)}
          </Text>
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
            <Text
              numberOfLines={2}
              style={{ ...type.footnote, color: colors.textSecondary, ...rtlText }}
            >
              {visit.services.join(" · ")}
            </Text>
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
          </View>
        </View>
      </View>

      {/* An unlinked Rekaz visit gets its action in place — no detour through
          another calendar step, per the operations plan. */}
      {!order && visit.reservation ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`طلب سائق لزيارة ${visit.customerName || visit.customerPhone}`}
          disabled={createOrder.isPending}
          onPress={requestDriver}
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
}

export default function OrdersScreen() {
  const { colors } = useTheme();
  const todayKey = dayKeyFromToday(0);
  const [selectedDay, setSelectedDay] = useState(todayKey);
  const [filter, setFilter] = useState<VisitFilter>("all");

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

  const dayVisits = useMemo(
    () =>
      visits
        .filter((visit) => dayKeyOf(visit.arrivalAt) === selectedDay)
        .filter((visit) => visitMatchesFilter(visit, filter, todayKey)),
    [visits, selectedDay, filter, todayKey],
  );

  const counts = useMemo(() => {
    const inDay = visits.filter(
      (visit) => dayKeyOf(visit.arrivalAt) === selectedDay,
    );
    return {
      all: inDay.length,
      today: inDay.filter((visit) => visitMatchesFilter(visit, "today", todayKey))
        .length,
      needs_driver: inDay.filter((visit) =>
        visitMatchesFilter(visit, "needs_driver", todayKey),
      ).length,
      exception: inDay.filter((visit) =>
        visitMatchesFilter(visit, "exception", todayKey),
      ).length,
    } satisfies Record<VisitFilter, number>;
  }, [visits, selectedDay, todayKey]);

  const showSkeleton = calendar.isLoading && visits.length === 0;
  const selectedDate = dayChipDate(selectedDay);

  return (
    <>
      <Stack.Screen
        options={{
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
          <DayStrip
            days={days}
            selected={selectedDay}
            onSelect={setSelectedDay}
            countsByDay={countsByDay}
          />
          <Text
            style={{
              ...type.subheadStrong,
              color: colors.textSecondary,
              paddingHorizontal: spacing.lg,
              ...rtlText,
            }}
          >
            {formatters.weekdayDate.format(selectedDate)}
          </Text>
        </View>

        <FlatList
          data={dayVisits}
          keyExtractor={(visit) => visit.key}
          renderItem={({ item }) => <VisitCard visit={item} />}
          contentContainerStyle={{
            paddingHorizontal: spacing.lg,
            paddingBottom: spacing["3xl"],
            flexGrow: 1,
          }}
          ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
          ListHeaderComponent={
            <View style={{ gap: spacing.md, paddingBottom: spacing.md }}>
              <RekazBanner selectedDayVisible />
              <Segmented
                layout="scroll"
                accessibilityLabel="تصفية زيارات اليوم"
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
      </View>
    </>
  );
}
