import { Link, Stack } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, RefreshControl, FlatList, Text, View } from "react-native";

import { EmptyState, ErrorState, LoadingScreen } from "@/components/screen-state";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { Segmented } from "@/components/ui/segmented";
import { radius, spacing, type } from "@/constants/theme";
import { useFieldI18n } from "@/lib/field-i18n";
import { useBootstrap, useFieldOrders } from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";
import type { FieldOrder, FieldOrderListView } from "@/types/api";

function OrderCard({ order }: { order: FieldOrder }) {
  const { colors } = useTheme();
  const { actionLabel, duration, formatTime, isRtl, relativeDay, rowDirection, t, textStyle } = useFieldI18n();
  // The visit is fully closed only once the driver confirms the return trip.
  const completed = Boolean(order.progress.driverReturnedAt);
  return (
    <Link href={{ pathname: "/field/orders/[id]", params: { id: order.id } }} asChild>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("openOrder", { customer: order.customerName ?? order.customerPhone })}
      >
        {({ pressed }) => (
          <Card style={{ gap: spacing.md, opacity: pressed ? 0.75 : completed ? 0.7 : 1 }}>
            <View style={{ flexDirection: rowDirection, alignItems: "flex-start", gap: spacing.md }}>
              <View style={{ flex: 1, gap: spacing.xs }}>
                <Text numberOfLines={1} style={{ ...type.title3, color: colors.text, ...textStyle }}>
                  {order.customerName || order.customerPhone}
                </Text>
                <Text style={{ ...type.calloutStrong, color: colors.brand, ...textStyle }}>
                  {relativeDay(order.arrivalAt)} · {formatTime(order.arrivalAt)}
                </Text>
              </View>
              <Badge
                label={completed ? t("completed") : order.canAct ? t("waitingForYou") : t("inProgress")}
                tone={completed ? "success" : order.canAct ? "warning" : "neutral"}
                icon={completed ? "checkmark.circle" : order.canAct ? "bell" : "clock"}
              />
            </View>
            <View style={{ flexDirection: rowDirection, alignItems: "center", gap: spacing.sm }}>
              <IconSymbol name="clock" size={15} color={colors.textTertiary} />
              <Text style={{ ...type.footnote, color: colors.textSecondary, ...textStyle }}>
                {duration(order.durationMinutes)}
              </Text>
            </View>
            <View
              style={{
                flexDirection: rowDirection,
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
                  ...textStyle,
                }}
              >
                {order.nextAction ? actionLabel(order.nextAction) : t("orderFinished")}
              </Text>
              <IconSymbol name={isRtl ? "chevron.left" : "chevron.right"} size={15} color={colors.textTertiary} />
            </View>
          </Card>
        )}
      </Pressable>
    </Link>
  );
}

export default function FieldOrdersScreen() {
  const { colors } = useTheme();
  const { t, textStyle } = useFieldI18n();
  const bootstrap = useBootstrap();
  const [view, setView] = useState<FieldOrderListView>("today");
  const orders = useFieldOrders(view);
  const name = bootstrap.data?.session.displayName ?? "";
  const orderViews = useMemo(
    () => [
      { value: "today" as const, label: t("today") },
      { value: "upcoming" as const, label: t("upcoming") },
      { value: "previous" as const, label: t("previous") },
      { value: "done" as const, label: t("completedTab") },
    ],
    [t],
  );
  const emptyCopy: Record<FieldOrderListView, { title: string; detail: string }> = {
    today: { title: t("noTodayTitle"), detail: t("noTodayDetail") },
    upcoming: { title: t("noUpcomingTitle"), detail: t("noUpcomingDetail") },
    previous: { title: t("noPreviousTitle"), detail: t("noPreviousDetail") },
    done: { title: t("noCompletedTitle"), detail: t("noCompletedDetail") },
  };
  if (orders.isLoading) return <LoadingScreen label={t("loadingOrders")} />;
  if (orders.isError) {
    return (
      <ErrorState
        title={t("ordersLoadError")}
        message={t("ordersLoadError")}
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
              <Pressable accessibilityRole="button" accessibilityLabel={t("account")} hitSlop={spacing.md}>
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
              <Text style={{ ...type.title2, color: colors.text, ...textStyle }}>{t("hello", { name })}</Text>
              <Text style={{ ...type.callout, color: colors.textSecondary, ...textStyle }}>
                {t("ordersGuidance")}
              </Text>
            </View>
            <Segmented
              accessibilityLabel={t("filterOrders")}
              options={orderViews}
              value={view}
              onChange={setView}
            />
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon={view === "done" ? "checkmark.circle" : "calendar"}
            title={emptyCopy[view].title}
            detail={emptyCopy[view].detail}
          />
        }
        refreshControl={
          <RefreshControl refreshing={orders.isRefetching} onRefresh={() => void orders.refetch()} tintColor={colors.brand} />
        }
      />
    </>
  );
}
