import { useRouter } from "expo-router";
import { memo, useCallback, useMemo, useRef, type ReactNode } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

import { radius, rtlText, spacing, type } from "@/constants/theme";
import {
  RIYADH_TZ,
  UNASSIGNED_COLUMN,
  dayKeyOf,
  riyadhMinutesOf,
  type DaySchedule,
  type ScheduleColumn,
  type ScheduleSlot,
} from "@/lib/calendar";
import { tapFeedback } from "@/lib/haptics";
import { useCreateOrderFromReservation } from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";

/** One hour of the day, in points. Tuned so a 20 minute service is tappable. */
const HOUR_HEIGHT = 88;
const GUTTER_WIDTH = 52;
const HEADER_HEIGHT = 40;
const MIN_SLOT_HEIGHT = 34;
/** A card narrower than this cannot be read, so the column widens instead. */
const MIN_LANE_WIDTH = 132;
const MAX_LANE_WIDTH = 172;

/**
 * Every clock face in the grid is Riyadh's.
 *
 * The shared `formatters.time` renders in the device's zone — right for a
 * phone in the salon, wrong for one that is not, and flatly wrong on the hour
 * ruler, where a UTC instant formatted locally printed "٤:٠٠ م" against the
 * 1:00 م row. The zone is pinned here rather than hoped for.
 */
const riyadhClock = new Intl.DateTimeFormat("ar-EG", {
  timeZone: RIYADH_TZ,
  hour: "numeric",
  minute: "2-digit",
});

/** The ruler labels whole hours, which are numbers rather than instants. */
const hourClock = new Intl.DateTimeFormat("ar-EG", {
  timeZone: "UTC",
  hour: "numeric",
  minute: "2-digit",
});

const hourLabel = (hour: number) =>
  hourClock.format(new Date(Date.UTC(2000, 0, 1, hour, 0)));

/** Wide enough to read; a double-booked column grows instead of splitting. */
const laneWidthOf = (column: ScheduleColumn) =>
  Math.max(MIN_LANE_WIDTH, Math.min(MAX_LANE_WIDTH, 340 / column.maxLanes));

const minuteOffset = (minutes: number, startHour: number) =>
  ((minutes - startHour * 60) / 60) * HOUR_HEIGHT;

const SlotCard = memo(function SlotCard({
  slot,
  startHour,
  laneWidth,
}: {
  slot: ScheduleSlot;
  startHour: number;
  laneWidth: number;
}) {
  const { colors } = useTheme();
  const router = useRouter();
  const createOrder = useCreateOrderFromReservation();

  const { reservation, order } = slot;
  const top = minuteOffset(slot.startMinutes, startHour);
  const height = Math.max(
    minuteOffset(slot.endMinutes, startHour) - top - 2,
    MIN_SLOT_HEIGHT,
  );
  /**
   * Tapping is the same journey the agenda offers, in the same order: an
   * existing order opens, and a booking with none is raised and handed to the
   * dispatch screen — where the driver and the messages are still reviewed
   * before anything is sent.
   */
  const open = () => {
    tapFeedback();
    if (order) {
      router.push({ pathname: "/orders/[id]", params: { id: order.id } });
      return;
    }
    if (createOrder.isPending) return;
    createOrder.mutate(reservation.id, {
      onSuccess: (result) =>
        router.push({
          pathname: "/orders/[id]/dispatch",
          params: {
            id: result.order.id,
            specialistName: reservation.providers[0] ?? "",
          },
        }),
      onError: (error) => Alert.alert("تعذّر إنشاء الطلب", error.message),
    });
  };

  const needsDriver = !order?.driver_id;
  const time = riyadhClock.format(new Date(reservation.arrivalAt));
  const roomForServices = height > 56;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${reservation.customerName || reservation.customerPhone}، ${slot.services.join(
        "، ",
      )}، ${time}${needsDriver ? "، بحاجة إلى سائق" : ""}`}
      onPress={open}
      style={{
        position: "absolute",
        top,
        height,
        // Lanes run right to left, the way the day itself is read here.
        right: slot.lane * laneWidth,
        width: laneWidth,
        paddingHorizontal: 2,
        opacity: createOrder.isPending ? 0.6 : 1,
      }}
    >
      <View
        style={{
          flex: 1,
          gap: 1,
          overflow: "hidden",
          paddingHorizontal: spacing.sm,
          paddingVertical: 4,
          borderRadius: radius.md,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: needsDriver ? colors.border : colors.brand,
          borderRightWidth: 3,
          borderRightColor: needsDriver ? colors.textTertiary : colors.brand,
          backgroundColor: needsDriver ? colors.surface : colors.brandSoft,
        }}
      >
        <Text
          numberOfLines={1}
          style={{
            ...type.caption,
            color: needsDriver ? colors.textSecondary : colors.onBrandSoft,
            fontVariant: ["tabular-nums"],
            ...rtlText,
          }}
        >
          {time}
          {/* The services are named below when there is room; the count is
              for the short card, where naming them would not fit. */}
          {slot.serviceCount > 1 && !roomForServices
            ? ` (${slot.serviceCount} خدمات)`
            : ""}
        </Text>
        <Text
          numberOfLines={1}
          style={{
            ...type.footnote,
            fontWeight: "700",
            color: needsDriver ? colors.text : colors.onBrandSoft,
            ...rtlText,
          }}
        >
          {reservation.customerName || reservation.customerPhone}
        </Text>
        {roomForServices ? (
          <Text
            numberOfLines={2}
            style={{
              ...type.caption,
              fontWeight: "400",
              color: needsDriver ? colors.textTertiary : colors.onBrandSoft,
              ...rtlText,
            }}
          >
            {slot.services.join(" · ")}
          </Text>
        ) : null}
        {/* The column names scroll away with the grid, so the card names its
            own specialist rather than leaving her to be counted off the top
            of the screen. */}
        {height > 84 && slot.columnId !== UNASSIGNED_COLUMN ? (
          <Text
            numberOfLines={1}
            style={{
              ...type.caption,
              fontWeight: "400",
              marginTop: "auto",
              color: needsDriver ? colors.textTertiary : colors.onBrandSoft,
              ...rtlText,
            }}
          >
            {slot.columnId}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
});

function ColumnName({ column, width }: { column: ScheduleColumn; width: number }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        width,
        height: HEADER_HEIGHT,
        justifyContent: "center",
        paddingHorizontal: spacing.sm,
        borderLeftWidth: 1,
        borderColor: colors.border,
      }}
    >
      <Text
        numberOfLines={1}
        style={{
          ...type.footnote,
          fontWeight: "700",
          color:
            column.id === UNASSIGNED_COLUMN ? colors.textTertiary : colors.text,
          textAlign: "center",
        }}
      >
        {column.name}
      </Text>
    </View>
  );
}

/**
 * The day as the salon reads it: specialists across, hours down.
 *
 * Deliberately not a FlatList. The whole point is that a slot sits at its own
 * time rather than after the row above it, so every card is placed absolutely
 * against the hour ruler and the grid is one measured surface.
 */
export function ScheduleGrid({
  schedule,
  dayKey,
  header,
}: {
  schedule: DaySchedule;
  dayKey: string;
  /**
   * The day picker and the view toggle ride inside this scroller on purpose.
   * iOS gives its automatic content inset to the scroll view, so a sibling
   * above it lands underneath the large header and the search bar — which is
   * exactly where the day strip had been hiding.
   */
  header?: ReactNode;
}) {
  const { colors } = useTheme();
  const { columns, slots, startHour, endHour } = schedule;
  const hours = useMemo(
    () => Array.from({ length: endHour - startHour }, (_, i) => startHour + i),
    [startHour, endHour],
  );
  const bodyHeight = hours.length * HOUR_HEIGHT;

  const slotsByColumn = useMemo(() => {
    const map = new Map<string, ScheduleSlot[]>();
    for (const slot of slots) {
      const bucket = map.get(slot.columnId) ?? [];
      bucket.push(slot);
      map.set(slot.columnId, bucket);
    }
    return map;
  }, [slots]);

  /**
   * The names row is sticky, so it cannot sit inside the horizontal scroller
   * the body uses. It gets its own, driven from the body's offset: a column
   * whose title has slid away from it is worse than no title at all.
   */
  const namesRef = useRef<ScrollView>(null);
  const onBodyScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      namesRef.current?.scrollTo({
        x: event.nativeEvent.contentOffset.x,
        animated: false,
      });
    },
    [],
  );

  // The "now" line only means something on the day being looked at.
  const nowOffset = useMemo(() => {
    const now = new Date();
    if (dayKeyOf(now) !== dayKey) return null;
    const offset = minuteOffset(riyadhMinutesOf(now.toISOString()), startHour);
    return offset >= 0 && offset <= bodyHeight ? offset : null;
  }, [dayKey, startHour, bodyHeight]);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      stickyHeaderIndices={header ? [1] : [0]}
      contentContainerStyle={{ paddingBottom: spacing["3xl"] }}
    >
      {header}

      <View
        style={{
          flexDirection: "row-reverse",
          backgroundColor: colors.background,
          borderBottomWidth: 1,
          borderColor: colors.border,
        }}
      >
        <View style={{ width: GUTTER_WIDTH }} />
        <ScrollView
          ref={namesRef}
          horizontal
          scrollEnabled={false}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ flexDirection: "row-reverse" }}
        >
          {columns.map((column) => (
            <ColumnName
              key={column.id}
              column={column}
              width={laneWidthOf(column) * column.maxLanes}
            />
          ))}
        </ScrollView>
      </View>

      {columns.length === 0 ? (
        <Text
          style={{
            ...type.subhead,
            color: colors.textTertiary,
            textAlign: "center",
            paddingVertical: spacing["3xl"],
          }}
        >
          لا توجد حجوزات في هذا اليوم
        </Text>
      ) : null}
      <View style={{ flexDirection: "row-reverse" }}>
        {/* Hour ruler. Outside the horizontal scroller so the times stay put
            while the specialists slide past them. */}
        <View style={{ width: GUTTER_WIDTH }}>
          {hours.map((hour) => (
            <View key={hour} style={{ height: HOUR_HEIGHT }}>
              <Text
                style={{
                  ...type.caption,
                  fontWeight: "400",
                  color: colors.textTertiary,
                  textAlign: "center",
                  fontVariant: ["tabular-nums"],
                }}
              >
                {hourLabel(hour)}
              </Text>
            </View>
          ))}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          onScroll={onBodyScroll}
          scrollEventThrottle={16}
          contentContainerStyle={{ flexDirection: "row-reverse" }}
        >
          {columns.map((column) => {
            const laneWidth = laneWidthOf(column);
            return (
              <View
                key={column.id}
                style={{
                  width: laneWidth * column.maxLanes,
                  height: bodyHeight,
                  borderLeftWidth: 1,
                  borderColor: colors.border,
                }}
              >
                {hours.map((hour, index) => (
                  <View
                    key={hour}
                    style={{
                      position: "absolute",
                      top: index * HOUR_HEIGHT,
                      left: 0,
                      right: 0,
                      height: HOUR_HEIGHT,
                      borderTopWidth: 1,
                      borderColor: colors.border,
                    }}
                  />
                ))}
                {nowOffset === null ? null : (
                  <View
                    style={{
                      position: "absolute",
                      top: nowOffset,
                      left: 0,
                      right: 0,
                      height: 2,
                      backgroundColor: colors.danger,
                    }}
                  />
                )}
                {(slotsByColumn.get(column.id) ?? []).map((slot) => (
                  <SlotCard
                    key={slot.key}
                    slot={slot}
                    startHour={startHour}
                    laneWidth={laneWidth}
                  />
                ))}
              </View>
            );
          })}
        </ScrollView>
      </View>
    </ScrollView>
  );
}
