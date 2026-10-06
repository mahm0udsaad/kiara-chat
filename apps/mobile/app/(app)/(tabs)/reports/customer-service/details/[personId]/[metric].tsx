import { Link, Redirect, Stack, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";

import {
  ReportMetricCard,
  ReportMetricGrid,
  ReportSectionHeader,
} from "@/components/reports/report-metric-card";
import { ErrorState } from "@/components/screen-state";
import { Card, Divider } from "@/components/ui/card";
import { IconSymbol, type IconName } from "@/components/ui/icon-symbol";
import { hitSize, numeric, radius, rtlText, spacing, type } from "@/constants/theme";
import { durationLabel, relativeTimeLabel } from "@/lib/format";
import { REPORT_LOCALE, reportInteger } from "@/lib/operations-report";
import {
  useBootstrap,
  useCustomerServiceEmployeeActivities,
  useCustomerServiceReport,
} from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";

type EmployeeMetric = "time" | "conversations" | "bookings" | "revenue" | "assigned" | "replies" | "resolved";

const METRIC_DETAILS: Record<EmployeeMetric, { title: string; description: string; icon: IconName }> = {
  time: {
    title: "وقتها داخل التطبيق",
    description: "وقت ظهور التطبيق في الواجهة، موزع حسب اليوم خلال الفترة المختارة.",
    icon: "clock",
  },
  conversations: {
    title: "المحادثات التي ردّت عليها",
    description: "كل محادثة تعاملت معها الموظفة، مع عدد ردودها وإجراءاتها.",
    icon: "message",
  },
  bookings: {
    title: "حجوزاتها في ركاز",
    description: "الحجوزات التي سجلها ركاز باسم الموظفة خلال الفترة المختارة.",
    icon: "calendar",
  },
  revenue: {
    title: "قيمة حجوزاتها",
    description: "إجمالي قيمة الحجوزات المنسوبة للموظفة، مع استبعاد الحجوزات الملغاة.",
    icon: "banknote",
  },
  assigned: {
    title: "المحادثات المسندة عليها الآن",
    description: "حالة المحادثات المسندة للموظفة وقت فتح التقرير.",
    icon: "tray",
  },
  replies: {
    title: "الردود التي أرسلتها",
    description: "المحادثات التي أرسلت فيها الموظفة ردوداً خلال الفترة المختارة.",
    icon: "paperplane.fill",
  },
  resolved: {
    title: "المحادثات التي أغلقتها",
    description: "عدد المحادثات التي غيّرت الموظفة حالتها إلى مغلقة خلال الفترة المختارة.",
    icon: "checkmark.circle",
  },
};

const dateLabel = new Intl.DateTimeFormat(REPORT_LOCALE, {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const currency = new Intl.NumberFormat(REPORT_LOCALE, {
  style: "currency",
  currency: "SAR",
  maximumFractionDigits: 0,
});

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function asMetric(value: string): EmployeeMetric {
  return value in METRIC_DETAILS ? value as EmployeeMetric : "conversations";
}

export default function CustomerServiceMetricDetailsScreen() {
  const params = useLocalSearchParams<{
    personId?: string | string[];
    metric?: string | string[];
    name?: string | string[];
    from?: string | string[];
    to?: string | string[];
    startTime?: string | string[];
    endTime?: string | string[];
  }>();
  const personId = one(params.personId);
  const metric = asMetric(one(params.metric));
  const fallbackName = one(params.name) || "موظفة خدمة العملاء";
  const from = one(params.from);
  const to = one(params.to);
  const startTime = one(params.startTime) || "00:00";
  const endTime = one(params.endTime) || "23:59";
  const details = METRIC_DETAILS[metric];
  const bootstrap = useBootstrap();
  const canViewReports = bootstrap.data?.capabilities.canViewReports === true;
  const report = useCustomerServiceReport(from, to, startTime, endTime, canViewReports && Boolean(personId));
  const showChats = metric === "conversations" || metric === "replies";
  const activities = useCustomerServiceEmployeeActivities(
    personId,
    from,
    to,
    startTime,
    endTime,
    canViewReports && showChats && Boolean(personId),
  );
  const { colors } = useTheme();

  if (bootstrap.isSuccess && !canViewReports) return <Redirect href="/inbox" />;
  if (report.isError) {
    return (
      <ErrorState
        title="تعذّر تحميل تفاصيل الأداء"
        message={report.error.message}
        onRetry={() => void report.refetch()}
      />
    );
  }
  if (activities.isError && showChats) {
    return (
      <ErrorState
        title="تعذّر تحميل المحادثات"
        message={activities.error.message}
        onRetry={() => void activities.refetch()}
      />
    );
  }

  const employee = report.data?.employees.find((item) => item.teamMemberId === personId);
  const name = employee?.name ?? fallbackName;
  const chats = activities.data?.pages.flatMap((page) => page.chats) ?? [];
  const value = !employee
    ? "—"
    : metric === "time"
      ? employee.activeMinutes ? durationLabel(employee.activeMinutes) : "—"
      : metric === "conversations"
        ? reportInteger.format(employee.handledConversations)
        : metric === "bookings"
          ? reportInteger.format(employee.rekazBookings ?? 0)
          : metric === "revenue"
            ? currency.format(employee.bookedRevenue ?? 0)
            : metric === "assigned"
              ? reportInteger.format(employee.currentAssigned)
              : metric === "replies"
                ? reportInteger.format(employee.messagesSent)
                : reportInteger.format(employee.resolvedConversations);

  const refreshing = report.isRefetching || activities.isRefetching;
  function refresh() {
    void report.refetch();
    if (showChats) void activities.refetch();
  }

  return (
    <>
      <Stack.Screen options={{ title: details.title }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.brand} />}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["5xl"], gap: spacing.lg }}
      >
        <Card variant="raised">
          <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.md }}>
            <IconSymbol name={details.icon} size={26} color={colors.brand} />
            <View style={{ flex: 1, gap: spacing.xs }}>
              <Text style={{ ...type.headline, ...rtlText, color: colors.text }}>{details.title}</Text>
              <Text selectable style={{ ...type.title2, ...numeric, ...rtlText, color: colors.brand }}>{value}</Text>
            </View>
          </View>
          <Text style={{ ...type.body, ...rtlText, color: colors.textSecondary }}>{details.description}</Text>
          <Text selectable style={{ ...type.caption, ...numeric, ...rtlText, color: colors.textTertiary }}>
            {name}{from && to ? ` · ${dateLabel.format(new Date(`${from}T12:00:00+03:00`))} – ${dateLabel.format(new Date(`${to}T12:00:00+03:00`))}` : ""}
          </Text>
        </Card>

        {report.isLoading || (showChats && activities.isLoading) ? (
          <ActivityIndicator size="large" color={colors.brand} />
        ) : null}

        {employee && metric === "time" ? (
          <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
            {employee.daily.length ? employee.daily.map((day, index) => (
              <View key={day.day}>
                {index ? <Divider /> : null}
                <View style={{ minHeight: hitSize.control, paddingVertical: spacing.md, flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", gap: spacing.md }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text selectable style={{ ...type.bodyStrong, ...numeric, ...rtlText, color: colors.text }}>
                      {dateLabel.format(new Date(`${day.day}T12:00:00+03:00`))}
                    </Text>
                    <Text selectable style={{ ...type.caption, ...numeric, ...rtlText, color: colors.textSecondary }}>
                      {reportInteger.format(day.handledConversations)} محادثة · {reportInteger.format(day.messagesSent)} رد
                    </Text>
                  </View>
                  <Text selectable style={{ ...type.subheadStrong, ...numeric, ...rtlText, color: colors.brand }}>
                    {day.activeMinutes ? durationLabel(day.activeMinutes) : "—"}
                  </Text>
                </View>
              </View>
            )) : (
              <Text style={{ paddingVertical: spacing.lg, ...type.body, ...rtlText, color: colors.textSecondary }}>
                لا يوجد وقت استخدام مسجل خلال الفترة المختارة.
              </Text>
            )}
          </Card>
        ) : null}

        {employee && (metric === "bookings" || metric === "revenue") ? (
          <View style={{ gap: spacing.md }}>
            <ReportSectionHeader title="تفاصيل الحجوزات" />
            <ReportMetricGrid>
              <ReportMetricCard tone="success" icon="calendar" label="حجوزات أدخلتها" value={employee.rekazBookings ?? 0} />
              <ReportMetricCard tone="success" icon="message" label="من محادثات ردّت عليها" value={employee.bookingsFromHerChats ?? 0} />
              <ReportMetricCard tone="brand" icon="banknote" label="قيمة الحجوزات" value={currency.format(employee.bookedRevenue ?? 0)} />
              <ReportMetricCard
                icon="chart.bar"
                label="تحويل المحادثات لحجز"
                value={employee.chatToBookingRate == null ? "—" : `${reportInteger.format(Math.round(employee.chatToBookingRate * 100))}%`}
              />
              <ReportMetricCard
                icon="clock"
                label="الوقت المعتاد حتى الحجز"
                value={employee.medianHoursToBooking == null ? "—" : durationLabel(Math.round(employee.medianHoursToBooking * 60))}
              />
            </ReportMetricGrid>
          </View>
        ) : null}

        {employee && metric === "assigned" ? (
          <View style={{ gap: spacing.md }}>
            <ReportSectionHeader title="حالة المحادثات المسندة" />
            <ReportMetricGrid>
              <ReportMetricCard tone="brand" icon="tray" label="إجمالي المسند الآن" value={employee.currentAssigned} />
              <ReportMetricCard tone="info" icon="message" label="قيد العمل" value={employee.currentRunning} />
              <ReportMetricCard tone="warning" icon="clock" label="بانتظار متابعة" value={employee.currentWaiting} />
              <ReportMetricCard tone="success" icon="checkmark.circle" label="مغلقة" value={employee.currentResolved} />
            </ReportMetricGrid>
          </View>
        ) : null}

        {employee && metric === "resolved" ? (
          <View style={{ gap: spacing.md }}>
            <ReportSectionHeader title="تفاصيل الإغلاق" />
            <ReportMetricGrid>
              <ReportMetricCard tone="success" icon="checkmark.circle" label="أغلقتها خلال الفترة" value={employee.resolvedConversations} />
              <ReportMetricCard icon="message" label="تعاملت معها" value={employee.handledConversations} />
              <ReportMetricCard
                icon="chart.bar"
                label="نسبة الإغلاق"
                value={employee.handledConversations
                  ? `${reportInteger.format(Math.round(employee.resolvedConversations / employee.handledConversations * 100))}%`
                  : "—"}
              />
            </ReportMetricGrid>
          </View>
        ) : null}

        {employee && showChats && chats.length ? (
          <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
            {chats.map((chat, index) => (
              <View key={chat.conversationId}>
                {index ? <Divider /> : null}
                <Link href={{ pathname: "/conversation/[id]", params: { id: chat.conversationId } }} asChild>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`محادثة ${chat.customerName ?? chat.customerPhone ?? "عميلة"}`}
                    accessibilityHint="يفتح المحادثة"
                    style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
                  >
                    <View style={{ minHeight: hitSize.control, paddingVertical: spacing.md, flexDirection: "row-reverse", alignItems: "center", gap: spacing.md }}>
                      <IconSymbol name="message" size={19} color={colors.brand} />
                      <View style={{ flex: 1, gap: spacing.xs }}>
                        <Text selectable style={{ ...type.bodyStrong, ...rtlText, color: colors.text }}>
                          {chat.customerName || chat.customerPhone || "محادثة"}
                        </Text>
                        <Text selectable style={{ ...type.caption, ...numeric, ...rtlText, color: colors.textSecondary }}>
                          {reportInteger.format(chat.replies)} رد · {reportInteger.format(chat.actions)} إجراء · آخر تعامل {relativeTimeLabel(chat.lastHandledAt)}
                        </Text>
                      </View>
                      <IconSymbol name="chevron.left" size={18} color={colors.textTertiary} />
                    </View>
                  </Pressable>
                </Link>
              </View>
            ))}
          </Card>
        ) : employee && showChats && !activities.isLoading ? (
          <Card>
            <Text style={{ ...type.body, ...rtlText, color: colors.textSecondary }}>
              لا توجد محادثات ضمن هذه النتيجة في الفترة المختارة.
            </Text>
          </Card>
        ) : null}

        {showChats && activities.hasNextPage ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="تحميل المزيد من المحادثات"
            onPress={() => void activities.fetchNextPage()}
            disabled={activities.isFetchingNextPage}
            style={({ pressed }) => ({
              minHeight: hitSize.control,
              padding: spacing.md,
              borderRadius: radius.lg,
              backgroundColor: colors.surface,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed || activities.isFetchingNextPage ? 0.65 : 1,
            })}
          >
            {activities.isFetchingNextPage ? (
              <ActivityIndicator size="small" color={colors.brand} />
            ) : (
              <Text style={{ ...type.subheadStrong, ...rtlText, color: colors.brand }}>تحميل المزيد</Text>
            )}
          </Pressable>
        ) : null}
      </ScrollView>
    </>
  );
}
