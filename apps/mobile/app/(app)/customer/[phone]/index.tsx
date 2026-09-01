import { Link, Stack, useLocalSearchParams } from "expo-router";
import { memo, useCallback, useMemo } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";

import { CustomerAnalysisView } from "@/components/customer-analysis-view";
import { PrimaryButton } from "@/components/primary-button";
import { EmptyState, ErrorState, InlineAlert } from "@/components/screen-state";
import { Badge } from "@/components/ui/badge";
import { Card, Divider } from "@/components/ui/card";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { SkeletonList } from "@/components/ui/skeleton";
import { hitSize, radius, rtlText, spacing, type } from "@/constants/theme";
import { formatPhone, formatters } from "@/lib/format";
import {
  useAnalyzeCustomer,
  useBootstrap,
  useCustomerTimeline,
} from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";
import type { CustomerInsights, TimelineEvent } from "@/types/api";

/**
 * One customer, whole — reachable from her name in the chat header and from a
 * visit on the calendar.
 *
 * There is no customers table anywhere in this system: a customer is a phone
 * number, and her record is assembled per read from Rekaz (every booking she
 * has ever had, the specialist who served her, what she paid) and from this
 * app (driver dispatches and internal notes). The server does that stitching
 * in `getCustomerTimeline`, shared with the web drawer, so the two surfaces
 * cannot drift apart.
 *
 * The body is her booking history, not her chat history: the messages live one
 * tap away in the thread itself, and repeating the last forty of them here
 * buried the thing the salon opens this screen for — what she has bought, from
 * whom, and for how much.
 */

type BookingEvent = Extract<TimelineEvent, { kind: "booking" }>;

/**
 * One visit: every service booked under the same Rekaz order. Rekaz stores a
 * reservation per service, so a customer who books a hammam and a massage
 * together has two rows that are one visit and one payment.
 */
type ProfileEntry =
  | { kind: "visit"; key: string; at: string; total: number; items: BookingEvent[] }
  | { kind: "other"; key: string; at: string; event: TimelineEvent };

const EMPTY_INSIGHTS: CustomerInsights = {
  topServices: [],
  favoriteProvider: null,
  cancelledRate: 0,
  avgSpend: 0,
  lastVisitAt: null,
  nextVisitAt: null,
  daysSinceLastVisit: null,
  bookedOnline: 0,
  bookedByStaff: 0,
};

const riyal = (value: number) => `${Math.round(value).toLocaleString("ar-EG")} ر.س`;

const STATUS_LABEL: Record<string, string> = {
  Cancelled: "ملغي",
  Confirmed: "مؤكد",
  Completed: "منتهي",
  Pending: "بانتظار التأكيد",
  NoShow: "لم تحضر",
};

const statusTone = (status: string) =>
  status === "Cancelled" || status === "NoShow"
    ? "danger"
    : status === "Confirmed" || status === "Completed"
      ? "success"
      : "neutral";

function initialOf(name: string | null | undefined, phone: string) {
  const trimmed = name?.trim();
  if (trimmed) return [...trimmed][0] ?? "؟";
  return [...phone.replace(/\D/g, "")].at(-2) ?? "؟";
}

function Stat({
  label,
  value,
  detail,
  tone = "text",
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "text" | "success" | "warning";
}) {
  const { colors } = useTheme();
  const color =
    tone === "success" ? colors.success : tone === "warning" ? colors.warning : colors.text;

  return (
    <View
      style={{
        flex: 1,
        minWidth: 132,
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
        selectable
        style={{ ...type.title3, color, fontVariant: ["tabular-nums"], ...rtlText }}
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

/** A service she books often, with a bar sized against her most-booked one. */
function ServiceRow({
  service,
  max,
}: {
  service: CustomerInsights["topServices"][number];
  max: number;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: spacing.xs }}>
      <View
        style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}
      >
        <Text
          numberOfLines={1}
          style={{ flex: 1, ...type.callout, color: colors.text, ...rtlText }}
        >
          {service.name}
        </Text>
        <Text
          style={{
            ...type.footnote,
            color: colors.textSecondary,
            fontVariant: ["tabular-nums"],
          }}
        >
          {`${service.count}× · ${riyal(service.spend)}`}
        </Text>
      </View>
      <View
        style={{
          height: 6,
          borderRadius: radius.full,
          overflow: "hidden",
          backgroundColor: colors.surfaceSunken,
        }}
      >
        <View
          style={{
            width: `${Math.max(8, Math.round((service.count / max) * 100))}%`,
            height: "100%",
            borderRadius: radius.full,
            backgroundColor: colors.brand,
          }}
        />
      </View>
    </View>
  );
}

/** One Rekaz order: the date, everything booked on it, and what it came to. */
const VisitCard = memo(function VisitCard({
  visit,
  upcomingFrom,
}: {
  visit: Extract<ProfileEntry, { kind: "visit" }>;
  /**
   * Her earliest future booking, as the server judged it. Comparing against it
   * marks the upcoming visits without reading the clock during render — the
   * server already knows what "now" was when it assembled the record.
   */
  upcomingFrom: string | null;
}) {
  const { colors } = useTheme();
  const at = new Date(visit.at);
  const upcoming = Boolean(upcomingFrom && visit.at >= upcomingFrom);
  // A visit is cancelled only when every service on it was.
  const cancelled = visit.items.every((item) => item.status === "Cancelled");
  const providers = [
    ...new Set(visit.items.flatMap((item) => item.providers).filter(Boolean)),
  ];

  return (
    <View
      style={{
        gap: spacing.sm,
        padding: spacing.md,
        borderRadius: radius.lg,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: upcoming ? colors.brand : colors.border,
        backgroundColor: colors.surface,
      }}
    >
      <View
        style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}
      >
        <IconSymbol
          name="calendar"
          size={15}
          color={cancelled ? colors.textTertiary : colors.brand}
        />
        <Text
          style={{ flex: 1, ...type.subheadStrong, color: colors.text, ...rtlText }}
        >
          {formatters.dateTime.format(at)}
        </Text>
        {upcoming ? <Badge label="قادم" tone="brand" /> : null}
        {cancelled ? <Badge label="ملغي" tone="danger" /> : null}
      </View>

      {visit.items.map((item, index) => (
        <View
          key={`${item.id}-${index}`}
          style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}
        >
          <Text
            style={{
              ...type.callout,
              color: item.status === "Cancelled" ? colors.textTertiary : colors.text,
              textDecorationLine: item.status === "Cancelled" ? "line-through" : "none",
              flex: 1,
              ...rtlText,
            }}
          >
            {item.service || "خدمة غير مسماة"}
          </Text>
          {item.amount ? (
            <Text
              style={{
                ...type.footnote,
                color: colors.textSecondary,
                fontVariant: ["tabular-nums"],
              }}
            >
              {riyal(item.amount)}
            </Text>
          ) : null}
        </View>
      ))}

      <Divider />

      <View
        style={{
          flexDirection: "row-reverse",
          alignItems: "center",
          flexWrap: "wrap",
          gap: spacing.xs + 2,
        }}
      >
        {providers.length ? (
          <Badge icon="person.crop.circle" label={providers.join("، ")} tone="neutral" />
        ) : null}
        {visit.items[0]?.payment ? (
          <Badge label={visit.items[0].payment} tone="neutral" />
        ) : null}
        {!cancelled && visit.items[0] ? (
          <Badge
            label={STATUS_LABEL[visit.items[0].status] ?? visit.items[0].status}
            tone={statusTone(visit.items[0].status)}
          />
        ) : null}
        <View style={{ flex: 1 }} />
        {visit.total ? (
          <Text
            selectable
            style={{
              ...type.calloutStrong,
              color: cancelled ? colors.textTertiary : colors.success,
              fontVariant: ["tabular-nums"],
            }}
          >
            {riyal(visit.total)}
          </Text>
        ) : null}
      </View>
    </View>
  );
});

/** A driver dispatch or an internal note, kept because both explain a visit. */
const OtherRow = memo(function OtherRow({ event }: { event: TimelineEvent }) {
  const { colors } = useTheme();
  if (event.kind !== "driver" && event.kind !== "note") return null;

  const icon = event.kind === "driver" ? "car" : "pencil";
  const title = event.kind === "driver" ? "طلب سائق" : (event.author ?? "ملاحظة داخلية");
  const body =
    event.kind === "driver"
      ? [event.driverName, event.specialistName].filter(Boolean).join(" · ") ||
        "بدون تعيين"
      : event.body;

  return (
    <View
      style={{
        flexDirection: "row-reverse",
        gap: spacing.sm,
        padding: spacing.md,
        borderRadius: radius.lg,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surfaceSunken,
      }}
    >
      <IconSymbol name={icon} size={15} color={colors.textSecondary} />
      <View style={{ flex: 1, gap: 2 }}>
        <View
          style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}
        >
          <Text
            style={{ flex: 1, ...type.footnote, color: colors.textSecondary, ...rtlText }}
          >
            {title}
          </Text>
          <Text
            style={{
              ...type.caption,
              color: colors.textTertiary,
              fontVariant: ["tabular-nums"],
            }}
          >
            {formatters.shortDate.format(new Date(event.at))}
          </Text>
        </View>
        <Text numberOfLines={3} style={{ ...type.callout, color: colors.text, ...rtlText }}>
          {body}
        </Text>
      </View>
    </View>
  );
});

const keyOfEntry = (entry: { key: string }) => entry.key;

export default function CustomerProfileScreen() {
  const { colors } = useTheme();
  const { phone: rawPhone, name } = useLocalSearchParams<{
    phone: string;
    name?: string;
  }>();
  const phone = String(rawPhone ?? "");
  const timeline = useCustomerTimeline(phone);
  const analysis = useAnalyzeCustomer(phone);
  const isAdmin = useBootstrap().data?.session.role === "admin";

  const customer = timeline.data?.customer;
  const revenue = timeline.data?.revenue;
  const insights = timeline.data?.insights ?? EMPTY_INSIGHTS;
  const nextVisitAt = insights.nextVisitAt;
  const displayName = customer?.name || name || formatPhone(phone);

  /**
   * Bookings collapse into visits; dispatches and notes stay as they are.
   * Messages are dropped — the thread is one tap away and this screen is the
   * record of what she bought.
   */
  // Hoisted so the list keeps one renderItem identity; the upcoming-visit
  // marker is the only screen state a row reads.
  const renderEntry = useCallback(
    ({ item }: { item: ProfileEntry }) =>
      item.kind === "visit" ? (
        <VisitCard visit={item} upcomingFrom={nextVisitAt} />
      ) : (
        <OtherRow event={item.event} />
      ),
    [nextVisitAt],
  );

  const entries = useMemo<ProfileEntry[]>(() => {
    const visits = new Map<string, Extract<ProfileEntry, { kind: "visit" }>>();
    const others: ProfileEntry[] = [];

    for (const event of timeline.data?.events ?? []) {
      if (event.kind === "booking") {
        const key = event.orderId || event.id;
        const visit = visits.get(key);
        if (visit) {
          visit.items.push(event);
          // The order's date is its earliest service.
          if (event.at < visit.at) visit.at = event.at;
        } else {
          visits.set(key, {
            kind: "visit",
            key,
            at: event.at,
            // Every reservation on an order repeats that order's total, so it
            // is read once rather than summed.
            total:
              event.orderTotal ||
              event.amount * (event.status === "Cancelled" ? 0 : 1),
            items: [event],
          });
        }
      } else if (event.kind === "driver" || event.kind === "note") {
        others.push({ kind: "other", key: `${event.kind}-${event.at}`, at: event.at, event });
      }
    }

    return [...visits.values(), ...others].sort((a, b) => b.at.localeCompare(a.at));
  }, [timeline.data?.events]);

  const showSkeleton = timeline.isLoading && !timeline.data;
  const topServiceMax = insights.topServices[0]?.count ?? 1;

  return (
    <>
      <Stack.Screen options={{ title: displayName }} />

      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        data={entries}
        keyExtractor={keyOfEntry}
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: spacing["3xl"],
          gap: spacing.sm,
          flexGrow: 1,
        }}
        renderItem={renderEntry}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        removeClippedSubviews={process.env.EXPO_OS === "android"}
        ListHeaderComponent={
          <View style={{ gap: spacing.lg, paddingBottom: spacing.md }}>
            {/* Identity */}
            <Card variant="raised">
              <View
                style={{
                  flexDirection: "row-reverse",
                  alignItems: "center",
                  gap: spacing.md,
                }}
              >
                <View
                  style={{
                    width: 56,
                    height: 56,
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: radius.full,
                    backgroundColor: colors.brandSoft,
                  }}
                >
                  <Text style={{ ...type.title2, color: colors.onBrandSoft }}>
                    {initialOf(customer?.name ?? name, phone)}
                  </Text>
                </View>
                <View style={{ flex: 1, gap: spacing.xs }}>
                  <Text
                    selectable
                    style={{ ...type.title3, color: colors.text, ...rtlText }}
                  >
                    {displayName}
                  </Text>
                  <Text
                    selectable
                    style={{
                      ...type.callout,
                      color: colors.textSecondary,
                      fontVariant: ["tabular-nums"],
                      // A phone number is an LTR run inside an RTL screen.
                      writingDirection: "ltr",
                      textAlign: "left",
                    }}
                  >
                    {formatPhone(phone)}
                  </Text>
                </View>
              </View>

              {customer?.labels.length ? (
                <View
                  style={{
                    flexDirection: "row-reverse",
                    flexWrap: "wrap",
                    gap: spacing.xs + 2,
                  }}
                >
                  {customer.labels.map((label) => (
                    <Badge key={label.name} label={label.name} tone="brand" />
                  ))}
                </View>
              ) : null}

              {customer?.conversationId ? (
                <>
                  <Divider />
                  <Link
                    href={{
                      pathname: "/conversation/[id]",
                      params: { id: customer.conversationId },
                    }}
                    asChild
                  >
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="فتح المحادثة الكاملة"
                      style={({ pressed }) => ({
                        minHeight: hitSize.comfortable,
                        flexDirection: "row-reverse",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: spacing.sm,
                        borderRadius: radius.md,
                        backgroundColor: colors.brandSoft,
                        opacity: pressed ? 0.72 : 1,
                      })}
                    >
                      <IconSymbol name="message" size={16} color={colors.onBrandSoft} />
                      <Text style={{ ...type.calloutStrong, color: colors.onBrandSoft }}>
                        {timeline.data?.messagesTotal
                          ? `فتح المحادثة (${timeline.data.messagesTotal} رسالة)`
                          : "فتح المحادثة الكاملة"}
                      </Text>
                    </Pressable>
                  </Link>

                  {/* Owner-only: who held this thread, and what each of them
                      did while they held it. Agents get a 403 from the API,
                      so the entrance is not shown to them either. */}
                  {isAdmin ? (
                    <Link
                      href={{
                        pathname: "/customer/[phone]/report",
                        params: {
                          phone,
                          conversationId: customer.conversationId,
                        },
                      }}
                      asChild
                    >
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="سجل المسؤولية والإجراءات"
                        style={({ pressed }) => ({
                          minHeight: hitSize.comfortable,
                          flexDirection: "row-reverse",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: spacing.sm,
                          borderRadius: radius.md,
                          borderWidth: 1,
                          borderColor: colors.border,
                          opacity: pressed ? 0.72 : 1,
                        })}
                      >
                        <IconSymbol
                          name="person.crop.circle"
                          size={16}
                          color={colors.brand}
                        />
                        <Text style={{ ...type.calloutStrong, color: colors.brand }}>
                          سجل المسؤولية والإجراءات
                        </Text>
                      </Pressable>
                    </Link>
                  ) : null}
                </>
              ) : null}
            </Card>

            {/* Rekaz is the source of truth for bookings and money. If it is
                unreachable the app half is still worth showing, but the totals
                below would be wrong to present as complete. */}
            {timeline.data?.rekazError ? (
              <InlineAlert
                tone="warning"
                message="تعذّر تحميل حجوزات ركاز — الأرقام أدناه غير مكتملة"
              />
            ) : null}

            {revenue ? (
              <View
                style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: spacing.sm }}
              >
                <Stat
                  label="إجمالي الإنفاق"
                  value={riyal(revenue.net)}
                  detail={revenue.refunded ? `${riyal(revenue.refunded)} مستردة` : undefined}
                  tone="success"
                />
                <Stat
                  label="الزيارات"
                  value={String(revenue.bookings)}
                  detail={revenue.cancelled ? `${revenue.cancelled} ملغاة` : undefined}
                />
                <Stat label="متوسط الزيارة" value={riyal(insights.avgSpend)} />
                <Stat
                  label="نسبة الإلغاء"
                  value={`${insights.cancelledRate}٪`}
                  tone={insights.cancelledRate >= 30 ? "warning" : "text"}
                />
              </View>
            ) : null}

            {/* Cadence: the two dates that decide whether she is due a call. */}
            {insights.lastVisitAt || insights.nextVisitAt ? (
              <Card>
                <Text style={{ ...type.headline, color: colors.text, ...rtlText }}>
                  إيقاع الزيارات
                </Text>
                {insights.lastVisitAt ? (
                  <View
                    style={{
                      flexDirection: "row-reverse",
                      alignItems: "center",
                      gap: spacing.sm,
                    }}
                  >
                    <IconSymbol name="clock" size={16} color={colors.textSecondary} />
                    <Text
                      style={{ flex: 1, ...type.callout, color: colors.text, ...rtlText }}
                    >
                      {`آخر زيارة: ${formatters.weekdayDate.format(
                        new Date(insights.lastVisitAt),
                      )}`}
                    </Text>
                    {insights.daysSinceLastVisit !== null ? (
                      <Badge
                        label={`منذ ${insights.daysSinceLastVisit} يوم`}
                        tone={insights.daysSinceLastVisit > 60 ? "warning" : "neutral"}
                      />
                    ) : null}
                  </View>
                ) : null}
                {insights.nextVisitAt ? (
                  <View
                    style={{
                      flexDirection: "row-reverse",
                      alignItems: "center",
                      gap: spacing.sm,
                    }}
                  >
                    <IconSymbol name="calendar" size={16} color={colors.brand} />
                    <Text
                      style={{ flex: 1, ...type.callout, color: colors.text, ...rtlText }}
                    >
                      {`الحجز القادم: ${formatters.dateTime.format(
                        new Date(insights.nextVisitAt),
                      )}`}
                    </Text>
                  </View>
                ) : null}
              </Card>
            ) : null}

            {/* What she books, and with whom. */}
            {insights.topServices.length ? (
              <Card>
                <View
                  style={{
                    flexDirection: "row-reverse",
                    alignItems: "center",
                    gap: spacing.sm,
                  }}
                >
                  <Text
                    style={{ flex: 1, ...type.headline, color: colors.text, ...rtlText }}
                  >
                    خدماتها الأكثر حجزًا
                  </Text>
                  {insights.favoriteProvider ? (
                    <Badge
                      icon="person.crop.circle"
                      label={`${insights.favoriteProvider.name} · ${insights.favoriteProvider.visits}`}
                      tone="brand"
                    />
                  ) : null}
                </View>
                {insights.topServices.map((service) => (
                  <ServiceRow key={service.name} service={service} max={topServiceMax} />
                ))}
                {insights.bookedOnline || insights.bookedByStaff ? (
                  <>
                    <Divider />
                    <Text
                      style={{ ...type.footnote, color: colors.textTertiary, ...rtlText }}
                    >
                      {`تحجز بنفسها ${insights.bookedOnline} مرة · بواسطة الموظفات ${insights.bookedByStaff} مرة`}
                    </Text>
                  </>
                ) : null}
              </Card>
            ) : null}

            {/* The model call is never made on open — an employee asks for it. */}
            <Card>
              <View
                style={{
                  flexDirection: "row-reverse",
                  alignItems: "center",
                  gap: spacing.sm,
                }}
              >
                <IconSymbol name="sparkles" size={18} color={colors.brand} />
                <Text
                  style={{ flex: 1, ...type.headline, color: colors.text, ...rtlText }}
                >
                  تحليل رضا العميلة
                </Text>
              </View>
              <Text style={{ ...type.footnote, color: colors.textTertiary, ...rtlText }}>
                قراءة آلية لمحادثتها وحجوزاتها: مدى رضاها، جودة تواصل الموظفات معها، وما يمكن
                تحسينه.
              </Text>
              {analysis.data ? (
                <CustomerAnalysisView analysis={analysis.data.analysis} />
              ) : null}
              {analysis.isError ? <InlineAlert message={analysis.error.message} /> : null}
              <PrimaryButton
                label={analysis.data ? "إعادة التحليل" : "تحليل رضا العميلة"}
                icon={analysis.data ? "arrow.clockwise" : "sparkles"}
                variant={analysis.data ? "outline" : "filled"}
                loading={analysis.isPending}
                onPress={() => analysis.mutate()}
              />
            </Card>

            {entries.length ? (
              <View
                style={{
                  flexDirection: "row-reverse",
                  alignItems: "center",
                  gap: spacing.sm,
                }}
              >
                <Text style={{ ...type.headline, color: colors.text, ...rtlText }}>
                  سجل الحجوزات
                </Text>
                <Text style={{ ...type.caption, color: colors.textTertiary }}>
                  {`${entries.filter((entry) => entry.kind === "visit").length} زيارة`}
                </Text>
              </View>
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
              title="لا توجد حجوزات"
              detail="لم تُسجَّل أي حجوزات لهذا الرقم في ركاز بعد."
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
