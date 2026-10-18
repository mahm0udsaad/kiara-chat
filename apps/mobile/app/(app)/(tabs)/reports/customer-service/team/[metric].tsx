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
  | "not-booked-total"
  | "new-customers"
  | "returning-customers"
  | "closed"
  | "closed-booked"
  | "closed-not-booked"
  | "messages-sent"
  | "no-reply"
  | "awaiting-outcome"
  | "active-now"
  | "time"
  | "conversations"
  | "bookings"
  | "revenue"
  | "assigned";

const METRICS: Record<TeamMetric, { title: string; description: string; icon: IconName; last24?: boolean; closed?: boolean }> = {
  "new-customers": { title: "عميلات جديدات", description: "عميلات راسلن خلال الفترة المختارة وليس لهن أي حجز سابق في ركاز قبل أول رسالة.", icon: "sparkles", last24: true },
  "returning-customers": { title: "عميلات سابقات", description: "عميلات راسلن خلال الفترة المختارة ولهن حجز في ركاز قبل أول رسالة منهن.", icon: "calendar", last24: true },
  closed: { title: "المحادثات المنتهية", description: "المحادثات التي أُغلقت خلال الفترة: بتغيير الحالة إلى منتهية، أو بتسجيل نتيجة، أو بإكمال الحجز.", icon: "checkmark.circle", closed: true },
  "closed-booked": { title: "انتهت بحجز", description: "محادثات أُغلقت خلال الفترة ولها حجز في ركاز برقم العميلة أو نتيجة «حجز».", icon: "calendar", closed: true },
  "closed-not-booked": { title: "انتهت دون حجز", description: "محادثات أُغلقت خلال الفترة دون حجز، مع النتيجة المسجلة لكل منها.", icon: "xmark.circle", closed: true },
  "messages-sent": { title: "رسائل أرسلها الفريق", description: "الرسائل التي أرسلتها كل موظفة للعميلات خلال الفترة المختارة. الرسائل الآلية لا تُنسب لموظفة.", icon: "paperplane.fill" },
  "inbound-messages": { title: "الرسائل الواردة", description: "الرسائل التي وصلت من العميلات خلال آخر ٢٤ ساعة، مجمعة حسب المحادثة.", icon: "message", last24: true },
  "inbound-conversations": { title: "المحادثات الواردة", description: "المحادثات التي وصلتها رسالة واحدة على الأقل خلال آخر ٢٤ ساعة.", icon: "person.2", last24: true },
  booked: { title: "الحجوزات المؤكدة", description: "العميلات اللاتي راسلن خلال آخر ٢٤ ساعة ولهن حجز في ركاز برقمهن، أو سُجلت نتيجة محادثتهن «حجز».", icon: "checkmark.circle", last24: true },
  "not-booked": { title: "لم يتم الحجز", description: "المحادثات الواردة التي انتهت نتيجتها دون حجز خلال آخر ٢٤ ساعة.", icon: "exclamationmark.circle", last24: true },
  "not-booked-total": { title: "لم يحجزن", description: "كل العميلات اللاتي راسلن خلال آخر ٢٤ ساعة دون حجز في ركاز أو نتيجة «حجز» في المحادثة، أياً كانت النتيجة المسجلة.", icon: "exclamationmark.circle", last24: true },
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
  if (metric === "messages-sent") return reportInteger.format(employee.messagesSent);
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
    scope?: string | string[];
  }>();
  const metric = asMetric(one(params.metric));
  const wantsPeriod = one(params.scope) === "period";
  const from = one(params.from);
  const to = one(params.to);
  const startTime = one(params.startTime) || "00:00";
  const endTime = one(params.endTime) || "23:59";
  const baseDetails = METRICS[metric];
  const details = wantsPeriod && baseDetails.last24
    ? { ...baseDetails, description: baseDetails.description.replace("آخر ٢٤ ساعة", "الفترة المختارة") }
    : baseDetails;
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
  const usesPeriod = wantsPeriod && Boolean(data?.period);
  const outcomes = usesPeriod ? data?.period : data?.last24Hours;
  const allLast24 = (usesPeriod ? data?.periodConversations : data?.last24HourConversations) ?? [];
  const conversations = details.closed
    ? (data?.closedConversations ?? []).filter((conversation) => {
      if (metric === "closed-booked") return conversation.outcome === "booked";
      if (metric === "closed-not-booked") return conversation.outcome !== "booked";
      return true;
    })
    : details.last24
    ? allLast24.filter((conversation) => {
      if (metric === "new-customers") return conversation.customerType === "new";
      if (metric === "returning-customers") return conversation.customerType === "returning";
      if (metric === "booked") return conversation.outcome === "booked";
      if (metric === "not-booked") return conversation.outcome === "not_booked";
      if (metric === "not-booked-total") return conversation.outcome !== "booked";
      if (metric === "no-reply") return conversation.outcome === "no_reply";
      if (metric === "awaiting-outcome") return conversation.outcome == null;
      return true;
    })
    : [];
  const employees = (data?.employees ?? []).filter((employee) => metric !== "active-now" || employee.activeNow);
  const value = !data
    ? "—"
    : metric === "new-customers"
      ? reportInteger.format(data.customerTypes?.new ?? 0)
      : metric === "returning-customers"
      ? reportInteger.format(data.customerTypes?.returning ?? 0)
      : metric === "closed"
      ? reportInteger.format(data.closed?.total ?? 0)
      : metric === "closed-booked"
      ? reportInteger.format(data.closed?.booked ?? 0)
      : metric === "closed-not-booked"
      ? reportInteger.format(data.closed?.notBooked ?? 0)
      : metric === "messages-sent"
      ? reportInteger.format(data.outbound?.team ?? data.totals.messagesSent)
      : metric === "not-booked-total"
      ? reportInteger.format(Math.max(0, (outcomes?.inboundConversations ?? 0) - (outcomes?.booked ?? 0)))
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

        {data && (details.last24 || details.closed) && conversations.length ? (
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
                              {conversation.closedAt
                                ? `أُغلقت ${relativeTimeLabel(conversation.closedAt)}`
                                : `${reportInteger.format(conversation.inboundMessages)} رسالة واردة · آخر رسالة ${relativeTimeLabel(conversation.lastInboundAt)}`}
                              {conversation.customerType === "returning" ? " · عميلة سابقة" : conversation.customerType === "new" ? " · عميلة جديدة" : ""}
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
        ) : data && (details.last24 || details.closed) ? (
          <Card>
            <Text style={{ ...type.body, ...rtlText, color: colors.textSecondary }}>
              {(details.closed ? data.closedConversations : allLast24)?.length
                ? "لا توجد محادثات ضمن هذه النتيجة."
                : "تفاصيل المحادثات غير متاحة من الخادم بعد؛ سيظل الإجمالي أعلاه صحيحاً."}
            </Text>
          </Card>
        ) : null}

        {data && !details.last24 && !details.closed && employees.length ? (
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
        ) : data && !details.last24 && !details.closed ? (
          <Card>
            <Text style={{ ...type.body, ...rtlText, color: colors.textSecondary }}>لا توجد نتائج ضمن هذه الفئة الآن.</Text>
          </Card>
        ) : null}
      </ScrollView>
    </>
  );
}
