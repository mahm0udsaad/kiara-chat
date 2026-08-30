import { useRouter } from "expo-router";
import { memo, useMemo } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";

import { radius, rtlText, spacing, type } from "@/constants/theme";
import {
  UNASSIGNED_COLUMN,
  riyadhMinutesOf,
  type DaySchedule,
  type ScheduleSlot,
} from "@/lib/calendar";
import { formatters } from "@/lib/format";
import { tapFeedback } from "@/lib/haptics";
import { useCreateOrderFromReservation } from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";

/** One hour of the day, in points. Tuned so a 20 minute service is tappable. */
const HOUR_HEIGHT = 88;
const COLUMN_WIDTH = 156;
const GUTTER_WIDTH = 52;
const MIN_SLOT_HEIGHT = 34;

const minuteOffset = (minutes: number, startHour: number) =>
  ((minutes - startHour * 60) / 60) * HOUR_HEIGHT;

/** `١١:٠٠ ص` from minutes past midnight, without inventing a Date in the tz. */
function hourLabel(hour: number): string {
  return formatters.time.format(new Date(Date.UTC(2000, 0, 1, hour, 0)));
}

const SlotCard = memo(function SlotCard({
  slot,
  startHour,
}: {
  slot: ScheduleSlot;
  startHour: number;
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
  const laneWidth = 1 / slot.lanes;

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
          params: { id: result.order.id },
        }),
      onError: (error) => Alert.alert("تعذّر إنشاء الطلب", error.message),
    });
  };

  const needsDriver = !order?.driver_id;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${reservation.customerName || reservation.customerPhone}، ${
        reservation.service
      }، ${formatters.time.format(new Date(reservation.arrivalAt))}${
        needsDriver ? "، بحاجة إلى سائق" : ""
      }`}
      onPress={open}
      style={{
        position: "absolute",
        top,
        height,
        // Overlapping bookings split the column rather than hiding each other.
        right: `${slot.lane * laneWidth * 100}%`,
        width: `${laneWidth * 100}%`,
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
          {formatters.time.format(new Date(reservation.arrivalAt))}
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
        {height > 52 ? (
          <Text
            numberOfLines={2}
            style={{
              ...type.caption,
              fontWeight: "400",
              color: needsDriver ? colors.textTertiary : colors.onBrandSoft,
              ...rtlText,
            }}
          >
            {reservation.service}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
});

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
}: {
  schedule: DaySchedule;
  dayKey: string;
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

  // The "now" line only means something on the day being looked at.
  const nowOffset = useMemo(() => {
    const now = new Date();
    if (dayKey !== new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Riyadh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now)) {
      return null;
    }
    const offset = minuteOffset(riyadhMinutesOf(now.toISOString()), startHour);
    return offset >= 0 && offset <= bodyHeight ? offset : null;
  }, [dayKey, startHour, bodyHeight]);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingBottom: spacing["3xl"] }}
    >
      <View style={{ flexDirection: "row-reverse" }}>
        {/* Hour ruler. Outside the horizontal scroller so the times stay put
            while the specialists slide past them. */}
        <View style={{ width: GUTTER_WIDTH }}>
          <View style={{ height: 44 }} />
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
          contentContainerStyle={{ flexDirection: "row-reverse" }}
        >
          {columns.map((column) => (
            <View key={column.id} style={{ width: COLUMN_WIDTH }}>
              <View
                style={{
                  height: 44,
                  justifyContent: "center",
                  paddingHorizontal: spacing.sm,
                  borderBottomWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <Text
                  numberOfLines={1}
                  style={{
                    ...type.footnote,
                    fontWeight: "700",
                    color:
                      column.id === UNASSIGNED_COLUMN
                        ? colors.textTertiary
                        : colors.text,
                    textAlign: "center",
                  }}
                >
                  {column.name}
                </Text>
              </View>

              <View
                style={{
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
                  <SlotCard key={slot.key} slot={slot} startHour={startHour} />
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    </ScrollView>
  );
}
