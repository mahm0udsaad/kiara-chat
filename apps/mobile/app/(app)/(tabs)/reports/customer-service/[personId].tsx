import { useState } from "react";
import { Link, Redirect, Stack, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";

import { ErrorState } from "@/components/screen-state";
import { PrimaryButton } from "@/components/primary-button";
import { BulletList, Score } from "@/components/customer-analysis-view";
import { Card } from "@/components/ui/card";
import { IconSymbol, type IconName } from "@/components/ui/icon-symbol";
import { hitSize, numeric, radius, rtlText, spacing, type } from "@/constants/theme";
import { relativeTimeLabel } from "@/lib/format";
import { REPORT_LOCALE, reportDecimal, reportInteger } from "@/lib/operations-report";
import {
  useBootstrap,
  useAnalyzeCustomerServiceAgent,
  useCustomerServiceEmployeeActivities,
  useCustomerServiceReport,
} from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";

const dateLabel = new Intl.DateTimeFormat(REPORT_LOCALE, {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function Metric({ icon, label, value }: { icon: IconName; label: string; value: number | string }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flex: 1,
        minWidth: 120,
        padding: spacing.md,
        gap: spacing.xs,
        borderRadius: radius.lg,
        backgroundColor: colors.surface,
      }}
    >
      <IconSymbol name={icon} size={18} color={colors.brand} />
      <Text style={{ ...type.caption, ...rtlText, color: colors.textTertiary }}>{label}</Text>
      <Text selectable style={{ ...type.title3, ...numeric, ...rtlText, color: colors.text }}>
        {typeof value === "number" ? reportInteger.format(value) : value}
      </Text>
    </View>
  );
}

export default function CustomerServiceEmployeeReportScreen() {
  const params = useLocalSearchParams<{
    personId?: string | string[];
    name?: string | string[];
    from?: string | string[];
    to?: string | string[];
    startTime?: string | string[];
    endTime?: string | string[];
  }>();
  const personId = one(params.personId);
  const fallbackName = one(params.name) || "موظفة خدمة العملاء";
  const from = one(params.from);
  const to = one(params.to);
  const startTime = one(params.startTime) || "08:00";
  const endTime = one(params.endTime) || "22:00";
  const bootstrap = useBootstrap();
  const { colors } = useTheme();

  const [hasRequestedActivities, setHasRequestedActivities] = useState(false);

  const report = useCustomerServiceReport(
    from,
    to,
    startTime,
    endTime,
    bootstrap.data?.capabilities.canViewReports === true && Boolean(personId),
  );

  const activitiesQuery = useCustomerServiceEmployeeActivities(
    personId,
    from,
    to,
    startTime,
    endTime,
    hasRequestedActivities && Boolean(personId),
  );
  const agentAnalysis = useAnalyzeCustomerServiceAgent(
    personId,
    from,
    to,
    startTime,
    endTime,
  );

  if (bootstrap.isSuccess && !bootstrap.data.capabilities.canViewReports) {
    return <Redirect href="/inbox" />;
  }
  if (report.isError) {
    return (
      <ErrorState
        title="تعذّر تحميل تقرير الموظفة"
        message={report.error.message}
        onRetry={() => void report.refetch()}
      />
    );
  }

  const employee = report.data?.employees.find((item) => item.teamMemberId === personId);
  const name = employee?.name ?? fallbackName;
  const breakdown = employee
    ? [
        ["استلام المحادثات", employee.claims],
        ["إطلاق المحادثات", employee.releases],
        ["التحويلات", employee.transfers],
        ["السحب من موظفة أخرى", employee.takeovers],
        ["تغييرات الحالة", employee.statusChanges],
        ["إجراءات الحجز", employee.bookingActions],
        ["الملاحظات الداخلية", employee.notesAdded],
        ["الطلبات المنشأة", employee.ordersCreated],
      ] as const
    : [];

  const handledChats = activitiesQuery.data?.pages.flatMap((page) => page.chats) ?? [];

  return (
    <>
      <Stack.Screen options={{ title: name }} />
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
        {report.isLoading ? <ActivityIndicator size="large" color={colors.brand} /> : null}

        {report.data && employee ? (
          <>
            <Card variant="raised">
              <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.md }}>
                <View style={{ flex: 1, gap: spacing.xs }}>
                  <Text selectable style={{ ...type.title3, ...rtlText, color: colors.text }}>{name}</Text>
                  <Text selectable style={{ ...type.footnote, ...numeric, ...rtlText, color: colors.textSecondary }}>
                    {dateLabel.format(new Date(`${from}T12:00:00+03:00`))} – {dateLabel.format(new Date(`${to}T12:00:00+03:00`))} · {startTime}–{endTime}
                  </Text>
                </View>
                <View
                  style={{
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.sm,
                    borderRadius: radius.full,
                    backgroundColor: employee.activeNow ? colors.successSoft : colors.surfaceSunken,
                  }}
                >
                  <Text
                    style={{
                      ...type.caption,
                      color: employee.activeNow ? colors.onSuccessSoft : colors.textTertiary,
                    }}
                  >
                    {employee.activeNow ? "نشطة الآن" : "غير نشطة الآن"}
                  </Text>
                </View>
              </View>
              <Text selectable style={{ ...type.footnote, ...rtlText, color: colors.textSecondary }}>
                {employee.lastSeenAt
                  ? `آخر ظهور ${relativeTimeLabel(employee.lastSeenAt)} · ${employee.platform ?? "تطبيق"}`
                  : "لم تُسجل نبضة تطبيق بعد"}
              </Text>
            </Card>

            <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: spacing.sm }}>
              <Metric icon="message" label="محادثات تعاملت معها" value={employee.handledConversations} />
              <Metric icon="paperplane.fill" label="ردود أرسلتها" value={employee.messagesSent} />
              <Metric icon="pencil" label="إجراءات نفّذتها" value={employee.actions} />
              <Metric icon="checkmark.circle" label="أغلقتها خلال الفترة" value={employee.resolvedConversations} />
              <Metric
                icon="clock"
                label="متوسط أول رد"
                value={
                  employee.averageFirstResponseMinutes == null
                    ? "—"
                    : `${reportDecimal.format(employee.averageFirstResponseMinutes)} د`
                }
              />
              <Metric icon="tray" label="مسندة الآن" value={employee.currentAssigned} />
              <Metric icon="clock" label="جارية الآن" value={employee.currentRunning} />
              <Metric icon="checkmark.circle" label="منتهية الآن" value={employee.currentResolved} />
            </View>

            <Card variant="raised">
              <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.md }}>
                <View style={{ flex: 1, gap: spacing.xs }}>
                  <Text style={{ ...type.headline, ...rtlText, color: colors.text }}>تحليل سلوك الموظفة بالذكاء الاصطناعي</Text>
                  <Text style={{ ...type.footnote, ...rtlText, color: colors.textSecondary }}>
                    يراجع أسلوب الرد وحل الطلبات والمتابعة في محادثات الفترة المختارة فقط.
                  </Text>
                </View>
                <IconSymbol name="sparkles" size={24} color={colors.brand} />
              </View>
              {agentAnalysis.data ? (
                <View style={{ gap: spacing.lg }}>
                  <Score value={agentAnalysis.data.analysis.score} label="تقييم جودة التعامل" />
                  <Text selectable style={{ ...type.body, ...rtlText, color: colors.textSecondary }}>
                    {agentAnalysis.data.analysis.summary}
                  </Text>
                  {agentAnalysis.data.analysis.strengths.length ? (
                    <View style={{ gap: spacing.sm }}>
                      <Text style={{ ...type.subheadStrong, ...rtlText, color: colors.success }}>نقاط القوة</Text>
                      <BulletList items={agentAnalysis.data.analysis.strengths} color={colors.text} />
                    </View>
                  ) : null}
                  {agentAnalysis.data.analysis.improvements.length ? (
                    <View style={{ gap: spacing.sm }}>
                      <Text style={{ ...type.subheadStrong, ...rtlText, color: colors.warning }}>فرص التحسين</Text>
                      <BulletList items={agentAnalysis.data.analysis.improvements} color={colors.text} />
                    </View>
                  ) : null}
                  {agentAnalysis.data.analysis.repeatedPatterns.length ? (
                    <View style={{ gap: spacing.sm }}>
                      <Text style={{ ...type.subheadStrong, ...rtlText, color: colors.text }}>أنماط متكررة</Text>
                      <BulletList items={agentAnalysis.data.analysis.repeatedPatterns} color={colors.textSecondary} />
                    </View>
                  ) : null}
                  {agentAnalysis.data.analysis.risks.length ? (
                    <View style={{ gap: spacing.sm }}>
                      <Text style={{ ...type.subheadStrong, ...rtlText, color: colors.danger }}>مخاطر تحتاج متابعة</Text>
                      <BulletList items={agentAnalysis.data.analysis.risks} color={colors.danger} />
                    </View>
                  ) : null}
                  <View style={{ gap: spacing.sm }}>
                    <Text style={{ ...type.subheadStrong, ...rtlText, color: colors.brand }}>خطوات مقترحة</Text>
                    <BulletList items={agentAnalysis.data.analysis.recommendations} color={colors.text} />
                  </View>
                  <Text style={{ ...type.caption, ...rtlText, color: colors.textTertiary }}>
                    بُني على {reportInteger.format(agentAnalysis.data.analysis.basis.conversations)} محادثة و{reportInteger.format(agentAnalysis.data.analysis.basis.agentReplies)} رد للموظفة.
                  </Text>
                </View>
              ) : agentAnalysis.isError ? (
                <Text style={{ ...type.body, ...rtlText, color: colors.danger }}>{agentAnalysis.error.message}</Text>
              ) : null}
              <PrimaryButton
                label={agentAnalysis.data ? "إعادة التحليل" : "تحليل المحادثات"}
                icon={agentAnalysis.data ? "arrow.clockwise" : "sparkles"}
                loading={agentAnalysis.isPending}
                onPress={() => agentAnalysis.mutate()}
              />
            </Card>

            <Card>
              <View style={{ gap: spacing.xs }}>
                <Text style={{ ...type.headline, ...rtlText, color: colors.text }}>تفصيل الإجراءات</Text>
                <Text style={{ ...type.footnote, ...rtlText, color: colors.textSecondary }}>
                  الردود منفصلة عن الإجراءات حتى لا يتضاعف الرقم.
                </Text>
              </View>
              <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: spacing.sm }}>
                {breakdown.map(([label, value]) => (
                  <View
                    key={label}
                    style={{
                      minWidth: "46%",
                      flex: 1,
                      padding: spacing.md,
                      borderRadius: radius.md,
                      backgroundColor: colors.surfaceSunken,
                    }}
                  >
                    <Text style={{ ...type.caption, ...rtlText, color: colors.textSecondary }}>{label}</Text>
                    <Text selectable style={{ ...type.headline, ...numeric, ...rtlText, color: colors.text }}>
                      {reportInteger.format(value)}
                    </Text>
                  </View>
                ))}
              </View>
            </Card>

            <Card>
              <Text style={{ ...type.headline, ...rtlText, color: colors.text }}>النشاط حسب اليوم</Text>
              {employee.daily.length ? (
                employee.daily.map((day) => (
                  <View
                    key={day.day}
                    style={{
                      minHeight: hitSize.min,
                      flexDirection: "row-reverse",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: spacing.md,
                    }}
                  >
                    <Text selectable style={{ ...type.subheadStrong, ...numeric, ...rtlText, color: colors.text }}>
                      {dateLabel.format(new Date(`${day.day}T12:00:00+03:00`))}
                    </Text>
                    <Text selectable style={{ ...type.caption, ...numeric, ...rtlText, color: colors.textSecondary }}>
                      {reportInteger.format(day.handledConversations)} محادثة · {reportInteger.format(day.messagesSent)} رد · {reportInteger.format(day.actions)} إجراء
                    </Text>
                  </View>
                ))
              ) : (
                <Text style={{ ...type.body, ...rtlText, color: colors.textSecondary }}>
                  لا يوجد نشاط خلال الفترة المختارة.
                </Text>
              )}
            </Card>

            <View style={{ gap: spacing.md }}>
              <View style={{ gap: spacing.xs }}>
                <Text style={{ ...type.title3, ...rtlText, color: colors.text }}>المحادثات التي تعاملت معها</Text>
                <Text style={{ ...type.footnote, ...rtlText, color: colors.textSecondary }}>
                  كل محادثة تظهر مرة واحدة مع عدد الردود والإجراءات خلال الفترة المختارة.
                </Text>
              </View>

              {!hasRequestedActivities ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="عرض المحادثات التي تم التعامل معها"
                  onPress={() => setHasRequestedActivities(true)}
                  style={({ pressed }) => ({
                    padding: spacing.md,
                    borderRadius: radius.lg,
                    backgroundColor: colors.surfaceSunken,
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text style={{ ...type.subheadStrong, ...rtlText, color: colors.brand }}>عرض المحادثات</Text>
                </Pressable>
              ) : activitiesQuery.isLoading ? (
                <ActivityIndicator size="small" color={colors.brand} />
              ) : activitiesQuery.isError ? (
                <Card variant="raised">
                  <View style={{ gap: spacing.sm, alignItems: "center" }}>
                    <Text style={{ ...type.body, ...rtlText, color: colors.danger }}>
                      {activitiesQuery.error.message || "تعذّر تحميل المحادثات"}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="إعادة المحاولة"
                      onPress={() => void activitiesQuery.refetch()}
                      style={({ pressed }) => ({
                        paddingHorizontal: spacing.md,
                        paddingVertical: spacing.xs,
                        borderRadius: radius.md,
                        backgroundColor: colors.surfaceSunken,
                        opacity: pressed ? 0.7 : 1,
                      })}
                    >
                      <Text style={{ ...type.caption, ...rtlText, color: colors.brand }}>إعادة المحاولة</Text>
                    </Pressable>
                  </View>
                </Card>
              ) : (
                <>
                  {handledChats.length ? (
                    handledChats.map((chat) => (
                      <Link
                        key={chat.conversationId}
                        href={{ pathname: "/conversation/[id]", params: { id: chat.conversationId } }}
                        asChild
                      >
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`محادثة ${chat.customerName ?? chat.customerPhone ?? "عميلة"}، ${chat.replies} ردود و${chat.actions} إجراءات`}
                          style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
                        >
                          <Card>
                            <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.md }}>
                              <IconSymbol name="message" size={20} color={colors.brand} />
                              <View style={{ flex: 1, gap: spacing.xs }}>
                                <Text selectable style={{ ...type.bodyStrong, ...rtlText, color: colors.text }}>
                                  {chat.customerName || chat.customerPhone || "محادثة"}
                                </Text>
                                <Text selectable style={{ ...type.footnote, ...rtlText, color: colors.textSecondary }}>
                                  {reportInteger.format(chat.replies)} رد · {reportInteger.format(chat.actions)} إجراء · آخر تعامل {relativeTimeLabel(chat.lastHandledAt)}
                                </Text>
                              </View>
                              <IconSymbol name="chevron.left" size={18} color={colors.textTertiary} />
                            </View>
                          </Card>
                        </Pressable>
                      </Link>
                    ))
                  ) : (
                    <Text style={{ ...type.body, ...rtlText, color: colors.textSecondary }}>
                      لم تتعامل الموظفة مع محادثات خلال الفترة المختارة.
                    </Text>
                  )}

                  {activitiesQuery.hasNextPage ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="تحميل المزيد من المحادثات"
                      onPress={() => void activitiesQuery.fetchNextPage()}
                      disabled={activitiesQuery.isFetchingNextPage}
                      style={({ pressed }) => ({
                        padding: spacing.md,
                        borderRadius: radius.lg,
                        backgroundColor: colors.surfaceSunken,
                        alignItems: "center",
                        justifyContent: "center",
                        opacity: pressed || activitiesQuery.isFetchingNextPage ? 0.7 : 1,
                      })}
                    >
                      {activitiesQuery.isFetchingNextPage ? (
                        <ActivityIndicator size="small" color={colors.brand} />
                      ) : (
                        <Text style={{ ...type.subheadStrong, ...rtlText, color: colors.brand }}>تحميل المزيد</Text>
                      )}
                    </Pressable>
                  ) : null}
                </>
              )}
            </View>
          </>
        ) : null}
      </ScrollView>
    </>
  );
}
