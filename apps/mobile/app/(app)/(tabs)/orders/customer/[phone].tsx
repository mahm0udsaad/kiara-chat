import { Link, Stack, useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";

import { EmptyState, ErrorState } from "@/components/screen-state";
import { Badge } from "@/components/ui/badge";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { SkeletonList } from "@/components/ui/skeleton";
import { hitSize, radius, rtlText, spacing, type } from "@/constants/theme";
import { formatPhone, formatters, relativeDayLabel } from "@/lib/format";
import { useCustomerTimeline } from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";
import type { TimelineEvent } from "@/types/api";

/**
 * The mobile half of the customer record the web /orders drawer already shows.
 * Same server read model, so the two surfaces cannot drift.
 *
 * Everything here is read-only. The satisfaction analysis is deliberately not
 * on this screen: it costs a model call and stays behind the explicit action
 * on the order it belongs to.
 */

function StatCard({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "brand" | "success";
}) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flex: 1,
        gap: spacing.xs,
        padding: spacing.md,
        borderRadius: radius.lg,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
      }}
    >
      <Text style={{ ...type.caption, color: colors.textTertiary, ...rtlText }}>
        {label}
      </Text>
      <Text
        style={{
          ...type.title2,
          color: tone === "success" ? colors.success : colors.text,
          fontVariant: ["tabular-nums"],
          ...rtlText,
        }}
      >
        {value}
      </Text>
      {detail ? (
        <Text style={{ ...type.caption, color: colors.textTertiary, ...rtlText }}>
          {detail}
        </Text>
      ) : null}
    </View>
  );
}

const EVENT_STYLE: Record<
  TimelineEvent["kind"],
  { icon: string; label: string }
> = {
  contact: { icon: "person.crop.circle", label: "أول تواصل" },
  message: { icon: "message", label: "رسالة" },
  booking: { icon: "calendar", label: "حجز" },
  driver: { icon: "car", label: "طلب سائق" },
  note: { icon: "pencil", label: "ملاحظة داخلية" },
};

function EventRow({ event }: { event: TimelineEvent }) {
  const { colors } = useTheme();
  const style = EVENT_STYLE[event.kind];
  const at = new Date(event.at);

  const body = (() => {
    switch (event.kind) {
      case "contact":
        return "بدأت المحادثة مع الصالون";
      case "message":
        return event.hasMedia && !event.content ? "مرفق" : event.content;
      case "booking":
        return [event.service, event.providers.join("، ")]
          .filter(Boolean)
          .join(" — ");
      case "driver":
        return [event.driverName, event.specialistName]
          .filter(Boolean)
          .join(" · ") || "بدون تعيين";
      case "note":
        return event.body;
    }
  })();

  const who =
    event.kind === "message"
      ? event.role === "customer"
        ? "الزبونة"
        : event.role === "agent"
          ? "الصالون"
          : "النظام"
      : event.kind === "note"
        ? (event.author ?? "ملاحظة")
        : style.label;

  return (
    <View
      style={{
        flexDirection: "row-reverse",
        gap: spacing.md,
        padding: spacing.md,
        borderRadius: radius.lg,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
      }}
    >
      <View
        style={{
          width: 32,
          height: 32,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: radius.full,
          backgroundColor: colors.surfaceSunken,
        }}
      >
        <IconSymbol
          name={style.icon as "calendar"}
          size={15}
          color={colors.textSecondary}
        />
      </View>

      <View style={{ flex: 1, gap: spacing.xs }}>
        <View
          style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}
        >
          <Text style={{ ...type.caption, color: colors.textSecondary, ...rtlText }}>
            {who}
          </Text>
          <View style={{ flex: 1 }} />
          <Text
            style={{
              ...type.caption,
              fontWeight: "400",
              color: colors.textTertiary,
              fontVariant: ["tabular-nums"],
            }}
          >
            {formatters.time.format(at)}
          </Text>
        </View>

        <Text
          numberOfLines={4}
          style={{ ...type.callout, color: colors.text, ...rtlText }}
        >
          {body}
        </Text>

        {event.kind === "booking" ? (
          <View
            style={{
              flexDirection: "row-reverse",
              flexWrap: "wrap",
              gap: spacing.xs + 2,
            }}
          >
            <Badge
              label={event.status}
              tone={
                event.status === "Cancelled"
                  ? "danger"
                  : event.status === "Confirmed"
                    ? "success"
                    : "neutral"
              }
            />
            {event.amount ? (
              <Badge label={`${event.amount} ر.س`} tone="neutral" />
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

export default function CustomerProfileScreen() {
  const { colors } = useTheme();
  const { phone: rawPhone, name } = useLocalSearchParams<{
    phone: string;
    name?: string;
  }>();
  const phone = String(rawPhone ?? "");
  const timeline = useCustomerTimeline(phone);

  const customer = timeline.data?.customer;
  const revenue = timeline.data?.revenue;

  // Events arrive newest first; group them under their day so the record reads
  // as a history rather than a flat list.
  const sections = useMemo(() => {
    const byDay = new Map<string, TimelineEvent[]>();
    for (const event of timeline.data?.events ?? []) {
      const key = new Date(event.at).toDateString();
      const bucket = byDay.get(key);
      if (bucket) bucket.push(event);
      else byDay.set(key, [event]);
    }
    return [...byDay.entries()];
  }, [timeline.data?.events]);

  const showSkeleton = timeline.isLoading && !timeline.data;

  return (
    <>
      <Stack.Screen
        options={{ title: customer?.name || name || "ملف العميلة" }}
      />

      <FlatList
        data={sections}
        keyExtractor={([day]) => day}
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: spacing["3xl"],
          gap: spacing.lg,
          flexGrow: 1,
        }}
        renderItem={({ item: [day, dayEvents] }) => (
          <View style={{ gap: spacing.sm }}>
            <Text
              style={{ ...type.subheadStrong, color: colors.textSecondary, ...rtlText }}
            >
              {relativeDayLabel(dayEvents[0]!.at)}
            </Text>
            <View style={{ gap: spacing.sm }}>
              {dayEvents.map((event, index) => (
                <EventRow key={`${day}-${index}`} event={event} />
              ))}
            </View>
          </View>
        )}
        ListHeaderComponent={
          <View style={{ gap: spacing.lg, paddingBottom: spacing.sm }}>
            <View style={{ gap: spacing.xs }}>
              <Text style={{ ...type.title2, color: colors.text, ...rtlText }}>
                {customer?.name || name || formatPhone(phone)}
              </Text>
              <Text
                style={{
                  ...type.callout,
                  color: colors.textSecondary,
                  fontVariant: ["tabular-nums"],
                  ...rtlText,
                }}
              >
                {formatPhone(phone)}
              </Text>
              {customer?.labels.length ? (
                <View
                  style={{
                    flexDirection: "row-reverse",
                    flexWrap: "wrap",
                    gap: spacing.xs + 2,
                    paddingTop: spacing.xs,
                  }}
                >
                  {customer.labels.map((label) => (
                    <Badge key={label.name} label={label.name} tone="brand" />
                  ))}
                </View>
              ) : null}
            </View>

            {revenue ? (
              <View style={{ flexDirection: "row-reverse", gap: spacing.md }}>
                <StatCard
                  label="الحجوزات"
                  value={String(revenue.bookings)}
                  detail={
                    revenue.cancelled ? `${revenue.cancelled} ملغاة` : undefined
                  }
                />
                <StatCard
                  label="إجمالي الإنفاق"
                  value={`${revenue.net} ر.س`}
                  detail={revenue.refunded ? `${revenue.refunded} مستردة` : undefined}
                  tone="success"
                />
              </View>
            ) : null}

            {customer?.firstContactAt ? (
              <View style={{ gap: spacing.xs }}>
                <Text
                  style={{ ...type.caption, color: colors.textTertiary, ...rtlText }}
                >
                  أول تواصل
                </Text>
                <Text style={{ ...type.callout, color: colors.text, ...rtlText }}>
                  {formatters.weekdayDate.format(new Date(customer.firstContactAt))}
                </Text>
              </View>
            ) : null}

            {/* Rekaz is the source of truth for bookings and money. If it is
                unreachable the app half is still worth showing, but the
                totals above would be wrong to present as complete. */}
            {timeline.data?.rekazError ? (
              <View
                style={{
                  flexDirection: "row-reverse",
                  alignItems: "center",
                  gap: spacing.sm,
                  padding: spacing.md,
                  borderRadius: radius.lg,
                  backgroundColor: colors.warningSoft,
                }}
              >
                <IconSymbol
                  name="exclamationmark.triangle"
                  size={15}
                  color={colors.onWarningSoft}
                />
                <Text
                  style={{
                    flex: 1,
                    ...type.footnote,
                    color: colors.onWarningSoft,
                    ...rtlText,
                  }}
                >
                  تعذّر تحميل حجوزات ركاز — الأرقام أعلاه غير مكتملة
                </Text>
              </View>
            ) : null}

            {customer?.conversationId ? (
              <Link
                href={{
                  pathname: "/inbox/[id]",
                  params: { id: customer.conversationId },
                }}
                asChild
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="فتح المحادثة الكاملة"
                  style={{
                    minHeight: hitSize.comfortable,
                    flexDirection: "row-reverse",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: spacing.sm,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: colors.borderStrong,
                    backgroundColor: colors.surface,
                  }}
                >
                  <IconSymbol name="message" size={16} color={colors.brand} />
                  <Text style={{ ...type.calloutStrong, color: colors.brand }}>
                    فتح المحادثة الكاملة
                  </Text>
                </Pressable>
              </Link>
            ) : null}

            {timeline.data && timeline.data.messagesTotal > timeline.data.messagesShown ? (
              <Text
                style={{ ...type.caption, color: colors.textTertiary, ...rtlText }}
              >
                {`تعرض آخر ${timeline.data.messagesShown} رسالة من ${timeline.data.messagesTotal}`}
              </Text>
            ) : null}

            {showSkeleton ? <SkeletonList count={4} /> : null}
          </View>
        }
        ListEmptyComponent={
          showSkeleton ? null : timeline.isError ? (
            <ErrorState
              message={timeline.error.message}
              onRetry={() => void timeline.refetch()}
            />
          ) : (
            <EmptyState
              icon="calendar"
              title="لا يوجد سجل بعد"
              detail="لا توجد حجوزات أو رسائل مسجلة لهذا الرقم."
            />
          )
        }
        refreshControl={
          <RefreshControl
            refreshing={timeline.isRefetching}
            onRefresh={() => void timeline.refetch()}
            tintColor={colors.brand}
          />
        }
      />
    </>
  );
}
