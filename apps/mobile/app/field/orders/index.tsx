import { Link, Stack } from "expo-router";
import { useState } from "react";
import { Pressable, RefreshControl, FlatList, Text, View } from "react-native";

import { EmptyState, ErrorState, LoadingScreen } from "@/components/screen-state";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { Segmented } from "@/components/ui/segmented";
import { radius, rtlText, spacing, type } from "@/constants/theme";
import { durationLabel, formatters, relativeDayLabel } from "@/lib/format";
import { useBootstrap, useFieldOrders } from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";
import type { FieldOrder, FieldOrderListView } from "@/types/api";

const ORDER_VIEWS: { value: FieldOrderListView; label: string }[] = [
  { value: "today", label: "اليوم" },
  { value: "upcoming", label: "القادمة" },
  { value: "previous", label: "السابقة" },
  { value: "done", label: "المكتملة" },
];

const EMPTY_COPY: Record<FieldOrderListView, { title: string; detail: string }> = {
  today: { title: "لا توجد طلبات اليوم", detail: "ستظهر طلبات اليوم هنا فور إسنادها لك." },
  upcoming: { title: "لا توجد طلبات قادمة", detail: "لا توجد رحلات مجدولة بعد اليوم." },
  previous: { title: "لا توجد طلبات سابقة", detail: "لا توجد طلبات أقدم في سجلك." },
  done: { title: "لا توجد طلبات مكتملة", detail: "تظهر هنا الطلبات بعد تأكيد عودة السائق." },
};

function OrderCard({ order }: { order: FieldOrder }) {
  const { colors } = useTheme();
  // The visit is fully closed only once the driver confirms the return trip.
  const completed = Boolean(order.progress.driverReturnedAt);
  return (
    <Link href={{ pathname: "/field/orders/[id]", params: { id: order.id } }} asChild>
      <Pressable accessibilityRole="button" accessibilityLabel={`فتح طلب ${order.customerName ?? order.customerPhone}`}>
        {({ pressed }) => (
          <Card style={{ gap: spacing.md, opacity: pressed ? 0.75 : completed ? 0.7 : 1 }}>
            <View style={{ flexDirection: "row-reverse", alignItems: "flex-start", gap: spacing.md }}>
              <View style={{ flex: 1, gap: spacing.xs }}>
                <Text numberOfLines={1} style={{ ...type.title3, color: colors.text, ...rtlText }}>
                  {order.customerName || order.customerPhone}
                </Text>
                <Text style={{ ...type.calloutStrong, color: colors.brand, ...rtlText }}>
                  {relativeDayLabel(order.arrivalAt)} · {formatters.time.format(new Date(order.arrivalAt))}
                </Text>
              </View>
              <Badge
                label={completed ? "مكتمل" : order.canAct ? "بانتظارك" : "قيد التنفيذ"}
                tone={completed ? "success" : order.canAct ? "warning" : "neutral"}
                icon={completed ? "checkmark.circle" : order.canAct ? "bell" : "clock"}
              />
            </View>
            <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}>
              <IconSymbol name="clock" size={15} color={colors.textTertiary} />
              <Text style={{ ...type.footnote, color: colors.textSecondary, ...rtlText }}>
                {durationLabel(order.durationMinutes)}
              </Text>
            </View>
            <View
              style={{
                flexDirection: "row-reverse",
                alignItems: "center",
                gap: spacing.sm,
                padding: spacing.md,
                borderRadius: radius.md,
                backgroundColor: order.canAct ? colors.warningSoft : colors.surfaceSunken,
              }}
            >
              <IconSymbol
                name={order.canAct ? "exclamationmark.circle" : "hourglass"}
                size={16}
                color={order.canAct ? colors.onWarningSoft : colors.textTertiary}
              />
              <Text
                numberOfLines={2}
                style={{
                  flex: 1,
                  ...type.footnote,
                  color: order.canAct ? colors.onWarningSoft : colors.textSecondary,
                  ...rtlText,
                }}
              >
                {order.nextActionLabel ?? "تم إنهاء الطلب"}
              </Text>
              <IconSymbol name="chevron.left" size={15} color={colors.textTertiary} />
            </View>
          </Card>
        )}
      </Pressable>
    </Link>
  );
}

export default function FieldOrdersScreen() {
  const { colors } = useTheme();
  const bootstrap = useBootstrap();
  const [view, setView] = useState<FieldOrderListView>("today");
  const orders = useFieldOrders(view);
  const name = bootstrap.data?.session.displayName ?? "";
  if (orders.isLoading) return <LoadingScreen label="جارٍ تحميل الطلبات…" />;
  if (orders.isError) {
    return (
      <ErrorState
        title="تعذر تحميل الطلبات"
        message={orders.error.message}
        onRetry={() => void orders.refetch()}
      />
    );
  }
  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Link href="/field/account" asChild>
              <Pressable accessibilityRole="button" accessibilityLabel="الحساب" hitSlop={spacing.md}>
                <IconSymbol name="person.crop.circle" color={colors.brand} size={24} />
              </Pressable>
            </Link>
          ),
        }}
      />
      <FlatList
        data={orders.data?.orders ?? []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <OrderCard order={item} />}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, flexGrow: 1, paddingBottom: spacing["4xl"] }}
        ListHeaderComponent={
          <View style={{ gap: spacing.lg, paddingBottom: spacing.xs }}>
            <View style={{ gap: spacing.xs }}>
              <Text style={{ ...type.title2, color: colors.text, ...rtlText }}>أهلًا {name}</Text>
              <Text style={{ ...type.callout, color: colors.textSecondary, ...rtlText }}>
                افتحي الطلب واتّبعي الخطوة الظاهرة فقط.
              </Text>
            </View>
            <Segmented
              accessibilityLabel="تصفية طلباتي"
              options={ORDER_VIEWS}
              value={view}
              onChange={setView}
            />
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon={view === "done" ? "checkmark.circle" : "calendar"}
            title={EMPTY_COPY[view].title}
            detail={EMPTY_COPY[view].detail}
          />
        }
        refreshControl={
          <RefreshControl refreshing={orders.isRefetching} onRefresh={() => void orders.refetch()} tintColor={colors.brand} />
        }
      />
    </>
  );
}
