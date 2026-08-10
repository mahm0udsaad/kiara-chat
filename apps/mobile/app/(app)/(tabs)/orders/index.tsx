import { Link, Stack } from "expo-router";
import { useDeferredValue, useMemo, useState } from "react";
import { Pressable, RefreshControl, SectionList, Text, View } from "react-native";

import { EmptyState, ErrorState } from "@/components/screen-state";
import { Badge } from "@/components/ui/badge";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { Segmented, type SegmentOption } from "@/components/ui/segmented";
import { SkeletonList } from "@/components/ui/skeleton";
import { radius, rtlText, spacing, type } from "@/constants/theme";
import {
  dayOffset,
  durationLabel,
  formatters,
  orderStatusIcon,
  orderStatusLabel,
  orderStatusTone,
  relativeDayLabel,
  tripTypeLabel,
} from "@/lib/format";
import { useOrders } from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";
import type { OrderStatus, OrderSummary } from "@/types/api";

type StatusFilter = "all" | OrderStatus;

const statusFilters: SegmentOption<StatusFilter>[] = [
  { value: "all", label: "الكل" },
  { value: "pending", label: "بانتظار الإرسال" },
  { value: "sent", label: "تم الإرسال" },
  { value: "failed", label: "فشل" },
];

/** Buckets orders into chronological day sections, soonest first. */
function groupByDay(orders: OrderSummary[]) {
  const buckets = new Map<string, OrderSummary[]>();
  const sorted = [...orders].sort(
    (a, b) => new Date(a.arrival_at).getTime() - new Date(b.arrival_at).getTime(),
  );

  for (const order of sorted) {
    const key = new Date(order.arrival_at).toDateString();
    const bucket = buckets.get(key);
    if (bucket) bucket.push(order);
    else buckets.set(key, [order]);
  }

  return [...buckets.entries()].map(([key, data]) => {
    const first = data[0]!;
    return {
      key,
      title: relativeDayLabel(first.arrival_at),
      offset: dayOffset(first.arrival_at),
      data,
    };
  });
}

function AssignmentChip({
  icon,
  name,
}: {
  icon: "sparkles" | "car";
  name: string | null;
}) {
  const { colors } = useTheme();
  const assigned = Boolean(name);
  return (
    <View
      style={{
        flexDirection: "row-reverse",
        alignItems: "center",
        gap: spacing.xs + 2,
        paddingHorizontal: spacing.sm + 2,
        paddingVertical: spacing.xs + 1,
        borderRadius: radius.full,
        borderWidth: 1,
        borderStyle: assigned ? "solid" : "dashed",
        borderColor: assigned ? colors.border : colors.borderStrong,
        backgroundColor: assigned ? colors.surfaceSunken : "transparent",
      }}
    >
      <IconSymbol
        name={icon}
        size={13}
        color={assigned ? colors.textSecondary : colors.textTertiary}
      />
      <Text
        numberOfLines={1}
        style={{
          ...type.caption,
          fontWeight: assigned ? "600" : "400",
          color: assigned ? colors.textSecondary : colors.textTertiary,
          ...rtlText,
        }}
      >
        {name ?? (icon === "car" ? "بدون سائق" : "بدون أخصائية")}
      </Text>
    </View>
  );
}

function OrderCard({ order }: { order: OrderSummary }) {
  const { colors } = useTheme();
  const arrival = new Date(order.arrival_at);
  const needsAttention = order.status === "failed";

  return (
    <Link href={{ pathname: "/orders/[id]", params: { id: order.id } }}>
      <Link.Trigger>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`طلب ${order.customer_name || order.customer_phone}، ${
            orderStatusLabel[order.status]
          }، ${formatters.time.format(arrival)}`}
          style={({ pressed }) => ({
            flexDirection: "row-reverse",
            gap: spacing.md,
            padding: spacing.lg,
            borderRadius: radius.xl,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: needsAttention ? colors.danger : colors.border,
            backgroundColor: pressed ? colors.surfaceSunken : colors.surface,
            boxShadow: "0 1px 2px rgba(24, 33, 77, 0.05)",
          })}
        >
          {/* Time rail — the one value an operator scans a schedule for. */}
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
            <Text style={{ ...type.caption, fontWeight: "400", color: colors.textTertiary }}>
              {durationLabel(order.duration_minutes)}
            </Text>
          </View>

          <View
            style={{ width: 1, backgroundColor: colors.border, marginVertical: spacing.xs }}
          />

          <View style={{ flex: 1, gap: spacing.sm }}>
            <View
              style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}
            >
              <Text
                numberOfLines={1}
                style={{ flex: 1, ...type.headline, color: colors.text, ...rtlText }}
              >
                {order.customer_name || order.customer_phone}
              </Text>
              <Badge
                label={orderStatusLabel[order.status]}
                tone={orderStatusTone[order.status]}
                icon={orderStatusIcon[order.status] as "clock"}
              />
            </View>

            <View
              style={{ flexDirection: "row-reverse", alignItems: "flex-start", gap: spacing.xs + 2 }}
            >
              <IconSymbol name="mappin.and.ellipse" color={colors.textTertiary} size={14} />
              <Text
                numberOfLines={2}
                style={{ flex: 1, ...type.footnote, color: colors.textSecondary, ...rtlText }}
              >
                {order.customer_location}
              </Text>
            </View>

            <View
              style={{
                flexDirection: "row-reverse",
                flexWrap: "wrap",
                alignItems: "center",
                gap: spacing.xs + 2,
              }}
            >
              <AssignmentChip icon="sparkles" name={order.specialist_name} />
              <AssignmentChip icon="car" name={order.driver_name} />
              <Text style={{ ...type.caption, fontWeight: "400", color: colors.textTertiary }}>
                {tripTypeLabel[order.trip_type]}
              </Text>
            </View>
          </View>
        </Pressable>
      </Link.Trigger>
      <Link.Preview />
    </Link>
  );
}

export default function OrdersScreen() {
  const { colors } = useTheme();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const orders = useOrders(deferredSearch.trim());

  const all = useMemo(() => orders.data?.orders.items ?? [], [orders.data]);

  const counts = useMemo(
    () => ({
      all: all.length,
      pending: all.filter((order) => order.status === "pending").length,
      sent: all.filter((order) => order.status === "sent").length,
      failed: all.filter((order) => order.status === "failed").length,
    }),
    [all],
  );

  const sections = useMemo(() => {
    const visible = status === "all" ? all : all.filter((order) => order.status === status);
    return groupByDay(visible);
  }, [all, status]);

  const showSkeleton = orders.isLoading && all.length === 0;

  return (
    <>
      <Stack.Screen
        options={{
          headerSearchBarOptions: {
            placeholder: "بحث بالاسم أو الموقع",
            onChangeText: (event) => setSearch(event.nativeEvent.text),
            onClose: () => setSearch(""),
            hideWhenScrolling: false,
          },
        }}
      />

      <SectionList
        contentInsetAdjustmentBehavior="automatic"
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <OrderCard order={item} />}
        stickySectionHeadersEnabled
        renderSectionHeader={({ section }) => (
          <View
            style={{
              flexDirection: "row-reverse",
              alignItems: "center",
              gap: spacing.sm,
              paddingVertical: spacing.sm,
              backgroundColor: colors.background,
            }}
          >
            <Text style={{ ...type.subheadStrong, color: colors.text, ...rtlText }}>
              {section.title}
            </Text>
            {section.offset < 0 ? <Badge label="فات موعده" tone="danger" icon="clock" /> : null}
            <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
            <Text
              style={{
                ...type.caption,
                fontWeight: "400",
                color: colors.textTertiary,
                fontVariant: ["tabular-nums"],
              }}
            >
              {section.data.length}
            </Text>
          </View>
        )}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"], flexGrow: 1 }}
        SectionSeparatorComponent={() => <View style={{ height: spacing.xs }} />}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        keyboardDismissMode="on-drag"
        ListHeaderComponent={
          <View style={{ gap: spacing.md, paddingBottom: spacing.sm }}>
            <Segmented
              layout="scroll"
              accessibilityLabel="تصفية الطلبات بالحالة"
              options={statusFilters.map((filter) => ({
                ...filter,
                count: counts[filter.value],
              }))}
              value={status}
              onChange={setStatus}
            />
            {showSkeleton ? <SkeletonList count={4} /> : null}
          </View>
        }
        ListEmptyComponent={
          showSkeleton ? null : orders.isError ? (
            <ErrorState message={orders.error.message} onRetry={() => void orders.refetch()} />
          ) : deferredSearch.trim() ? (
            <EmptyState
              icon="magnifyingglass"
              title="لا توجد نتائج"
              detail={`لم نعثر على طلب يطابق «${deferredSearch.trim()}».`}
            />
          ) : status !== "all" ? (
            <EmptyState
              icon="calendar"
              title="لا توجد طلبات بهذه الحالة"
              detail="جرّبي تغيير الفلتر لعرض بقية الطلبات."
              action={{ label: "عرض كل الطلبات", onPress: () => setStatus("all") }}
            />
          ) : (
            <EmptyState
              icon="calendar"
              title="لا توجد طلبات"
              detail="افتحي أي طلب لتعديل بيانات الحجز أو تأكيد الإرسال إلى الأخصائية والسائق."
            />
          )
        }
        refreshControl={
          <RefreshControl
            refreshing={orders.isRefetching}
            onRefresh={() => void orders.refetch()}
            tintColor={colors.brand}
          />
        }
      />
    </>
  );
}
