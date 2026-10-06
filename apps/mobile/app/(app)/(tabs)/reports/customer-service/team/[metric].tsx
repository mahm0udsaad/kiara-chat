import { Link, Redirect, Stack, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";

import { ErrorState } from "@/components/screen-state";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card, Divider } from "@/components/ui/card";
import { IconSymbol, type IconName } from "@/components/ui/icon-symbol";
import { hitSize, numeric, rtlText, spacing, type } from "@/constants/theme";
import { durationLabel, relativeTimeLabel } from "@/lib/format";
import { REPORT_LOCALE, reportInteger } from "@/lib/operations-report";
import { useBootstrap, useCustomerServiceReport } from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";
import type { CustomerServiceEmployee, CustomerServiceLast24Conversation } from "@/types/api";

type TeamMetric =
  | "inbound-messages"
  | "inbound-conversations"
  | "booked"
  | "not-booked"
  | "no-reply"
  | "awaiting-outcome"
  | "active-now"
  | "time"
  | "conversations"
  | "bookings"
  | "revenue"
  | "assigned";

const METRICS: Record<TeamMetric, { title: string; description: string; icon: IconName; last24?: boolean }> = {
  "inbound-messages": { title: "الرسائل الواردة", description: "الرسائل التي وصلت من العميلات خلال آخر ٢٤ ساعة، مجمعة حسب المحادثة.", icon: "message", last24: true },
  "inbound-conversations": { title: "المحادثات الواردة", description: "المحادثات التي وصلتها رسالة واحدة على الأقل خلال آخر ٢٤ ساعة.", icon: "person.2", last24: true },
  booked: { title: "الحجوزات المؤكدة", description: "المحادثات الواردة التي سُجلت نتيجتها كحجز مؤكد خلال آخر ٢٤ ساعة.", icon: "checkmark.circle", last24: true },
  "not-booked": { title: "لم يتم الحجز", description: "المحادثات الواردة التي انتهت نتيجتها دون حجز خلال آخر ٢٤ ساعة.", icon: "exclamationmark.circle", last24: true },
  "no-reply": { title: "العميلات اللاتي لم يرددن", description: "المحادثات الواردة التي سُجلت نتيجتها أن العميلة لم ترد.", icon: "phone", last24: true },
  "awaiting-outcome": { title: "بانتظار النتيجة", description: "المحادثات الواردة التي لم تُسجل لها نتيجة نهائية بعد.", icon: "clock", last24: true },
  "active-now": { title: "النشطات الآن", description: "موظفات خدمة العملاء الظاهرات كنشطات وقت تحديث التقرير.", icon: "checkmark.circle" },
  time: { title: "وقت الفريق في المحادثات", description: "الوقت الذي كانت فيه كل موظفة داخل محادثة مفتوحة وتتفاعل معها (لمس أو كتابة خلال آخر ٣ دقائق) خلال الفترة المختارة.", icon: "clock" },
  conversations: { title: "المحادثات التي تعامل معها الفريق", description: "عدد المحادثات المختلفة التي تعاملت معها كل موظفة خلال الفترة المختارة.", icon: "message" },
  bookings: { title: "حجوزات ركاز", description: "الحجوزات التي سجلها ركاز باسم كل موظفة خلال الفترة المختارة.", icon: "calendar" },
  revenue: { title: "قيمة الحجوزات", description: "قيمة الحجوزات المنسوبة لكل موظفة، مع استبعاد الحجوزات الملغاة.", icon: "banknote" },
  assigned: { title: "المحادثات المسندة الآن", description: "المحادثات المسندة حالياً لكل موظفة، حسب حالتها الحالية.", icon: "tray" },
};

const currency = new Intl.NumberFormat(REPORT_LOCALE, {
  style: "currency",
  currency: "SAR",
  maximumFractionDigits: 0,
});

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function asMetric(value: string): TeamMetric {
  return value in METRICS ? value as TeamMetric : "conversations";
}

function employeeValue(employee: CustomerServiceEmployee, metric: TeamMetric): string {
  if (metric === "active-now") return employee.activeNow ? "نشطة الآن" : "غير نشطة";
  if (metric === "time") return employee.chatMinutes ? durationLabel(employee.chatMinutes) : "—";
  if (metric === "conversations") return reportInteger.format(employee.handledConversations);
  if (metric === "bookings") return reportInteger.format(employee.rekazBookings ?? 0);
  if (metric === "revenue") return currency.format(employee.bookedRevenue ?? 0);
  if (metric === "assigned") return reportInteger.format(employee.currentAssigned);
  return "—";
}

function outcomePresentation(outcome: CustomerServiceLast24Conversation["outcome"]): {
  label: string;
  tone: BadgeTone;
  icon: IconName;
} {
  if (outcome === "booked") return { label: "حجز مؤكد", tone: "success", icon: "checkmark.circle" };
  if (outcome === "not_booked") return { label: "لم يتم الحجز", tone: "warning", icon: "exclamationmark.circle" };
  if (outcome === "no_reply") return { label: "لم ترد", tone: "neutral", icon: "phone" };
  return { label: "بانتظار النتيجة", tone: "info", icon: "clock" };
}

export default function CustomerServiceTeamMetricScreen() {
  const params = useLocalSearchParams<{
    metric?: string | string[];
    from?: string | string[];
    to?: string | string[];
    startTime?: string | string[];
    endTime?: string | string[];
  }>();
  const metric = asMetric(one(params.metric));
  const from = one(params.from);
  const to = one(params.to);
  const startTime = one(params.startTime) || "00:00";
  const endTime = one(params.endTime) || "23:59";
  const details = METRICS[metric];
  const bootstrap = useBootstrap();
  const canViewReports = bootstrap.data?.capabilities.canViewReports === true;
  const report = useCustomerServiceReport(from, to, startTime, endTime, canViewReports);
  const { colors } = useTheme();

  if (bootstrap.isSuccess && !canViewReports) return <Redirect href="/inbox" />;
  if (report.isError) {
    return (
      <ErrorState
        title="تعذّر تحميل تفاصيل الفريق"
        message={report.error.message}
        onRetry={() => void report.refetch()}
      />
    );
  }

  const data = report.data;
  const outcomes = data?.last24Hours;
  const allLast24 = data?.last24HourConversations ?? [];
  const conversations = details.last24
    ? allLast24.filter((conversation) => {
      if (metric === "booked") return conversation.outcome === "booked";
      if (metric === "not-booked") return conversation.outcome === "not_booked";
      if (metric === "no-reply") return conversation.outcome === "no_reply";
      if (metric === "awaiting-outcome") return conversation.outcome == null;
      return true;
    })
    : [];
  const employees = (data?.employees ?? []).filter((employee) => metric !== "active-now" || employee.activeNow);
  const value = !data
    ? "—"
    : metric === "inbound-messages"
      ? reportInteger.format(outcomes?.inboundMessages ?? 0)
      : metric === "inbound-conversations"
        ? reportInteger.format(outcomes?.inboundConversations ?? 0)
        : metric === "booked"
          ? reportInteger.format(outcomes?.booked ?? 0)
          : metric === "not-booked"
            ? reportInteger.format(outcomes?.notBooked ?? 0)
            : metric === "no-reply"
              ? reportInteger.format(outcomes?.noReply ?? 0)
              : metric === "awaiting-outcome"
                ? reportInteger.format(outcomes?.awaitingOutcome ?? 0)
                : metric === "active-now"
                  ? reportInteger.format(data.totals.activeNow)
                  : metric === "time"
                    ? data.totals.chatMinutes ? durationLabel(data.totals.chatMinutes) : "—"
                    : metric === "conversations"
                      ? reportInteger.format(data.totals.handledConversations)
                      : metric === "bookings"
                        ? reportInteger.format(data.totals.rekazBookings ?? 0)
                        : metric === "revenue"
                          ? currency.format(data.totals.bookedRevenue ?? 0)
                          : reportInteger.format(data.totals.currentAssigned);

  return (
    <>
      <Stack.Screen options={{ title: details.title }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={
          <RefreshControl
            refreshing={report.isRefetching}
            onRefresh={() => void report.refetch()}
            tintColor={colors.brand}
          />
        }
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
        </Card>

        {report.isLoading ? <ActivityIndicator size="large" color={colors.brand} /> : null}

        {data && details.last24 && conversations.length ? (
          <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
            {conversations.map((conversation, index) => {
              const presentation = outcomePresentation(conversation.outcome);
              return (
                <View key={conversation.conversationId}>
                  {index ? <Divider /> : null}
                  <Link href={{ pathname: "/conversation/[id]", params: { id: conversation.conversationId } }} asChild>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`محادثة ${conversation.customerName || conversation.customerPhone || "عميلة"}`}
                      accessibilityHint="يفتح المحادثة"
                      style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
                    >
                      <View style={{ minHeight: hitSize.control, paddingVertical: spacing.md, gap: spacing.sm }}>
                        <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}>
                          <View style={{ flex: 1, gap: 2 }}>
                            <Text selectable style={{ ...type.bodyStrong, ...rtlText, color: colors.text }}>
                              {conversation.customerName || conversation.customerPhone || "محادثة"}
                            </Text>
                            <Text selectable style={{ ...type.caption, ...numeric, ...rtlText, color: colors.textSecondary }}>
                              {reportInteger.format(conversation.inboundMessages)} رسالة واردة · آخر رسالة {relativeTimeLabel(conversation.lastInboundAt)}
                            </Text>
                          </View>
                          <IconSymbol name="chevron.left" size={18} color={colors.textTertiary} />
                        </View>
                        <View style={{ alignItems: "flex-end" }}>
                          <Badge label={presentation.label} tone={presentation.tone} icon={presentation.icon} />
                        </View>
                      </View>
                    </Pressable>
                  </Link>
                </View>
              );
            })}
          </Card>
        ) : data && details.last24 ? (
          <Card>
            <Text style={{ ...type.body, ...rtlText, color: colors.textSecondary }}>
              {allLast24.length
                ? "لا توجد محادثات ضمن هذه النتيجة."
                : "تفاصيل المحادثات غير متاحة من الخادم بعد؛ سيظل الإجمالي أعلاه صحيحاً."}
            </Text>
          </Card>
        ) : null}

        {data && !details.last24 && employees.length ? (
          <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
            {employees.map((employee, index) => (
              <View key={employee.teamMemberId}>
                {index ? <Divider /> : null}
                <Link
                  href={{
                    pathname: "/reports/customer-service/[personId]",
                    params: {
                      personId: employee.teamMemberId,
                      name: employee.name,
                      from,
                      to,
                      startTime,
                      endTime,
                    },
                  }}
                  asChild
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`تفاصيل أداء ${employee.name}`}
                    style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
                  >
                    <View style={{ minHeight: hitSize.control, paddingVertical: spacing.md, flexDirection: "row-reverse", alignItems: "center", gap: spacing.md }}>
                      <View style={{ flex: 1, gap: spacing.xs }}>
                        <Text selectable style={{ ...type.bodyStrong, ...rtlText, color: colors.text }}>{employee.name}</Text>
                        {metric === "assigned" ? (
                          <Text selectable style={{ ...type.caption, ...numeric, ...rtlText, color: colors.textSecondary }}>
                            {reportInteger.format(employee.currentRunning)} قيد العمل · {reportInteger.format(employee.currentWaiting)} بانتظار متابعة · {reportInteger.format(employee.currentResolved)} مغلقة
                          </Text>
                        ) : null}
                      </View>
                      <Text selectable style={{ ...type.subheadStrong, ...numeric, ...rtlText, color: colors.brand }}>
                        {employeeValue(employee, metric)}
                      </Text>
                      <IconSymbol name="chevron.left" size={18} color={colors.textTertiary} />
                    </View>
                  </Pressable>
                </Link>
              </View>
            ))}
          </Card>
        ) : data && !details.last24 ? (
          <Card>
            <Text style={{ ...type.body, ...rtlText, color: colors.textSecondary }}>لا توجد نتائج ضمن هذه الفئة الآن.</Text>
          </Card>
        ) : null}
      </ScrollView>
    </>
  );
}
