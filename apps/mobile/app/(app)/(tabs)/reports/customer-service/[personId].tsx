import { useState } from "react";
import { Link, Redirect, Stack, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";

import { ErrorState } from "@/components/screen-state";
import { Card } from "@/components/ui/card";
import { IconSymbol, type IconName } from "@/components/ui/icon-symbol";
import { hitSize, numeric, radius, rtlText, spacing, type } from "@/constants/theme";
import { relativeTimeLabel } from "@/lib/format";
import { REPORT_LOCALE, reportDecimal, reportInteger } from "@/lib/operations-report";
import {
  useBootstrap,
  useCustomerServiceEmployeeActivities,
  useCustomerServiceReport,
} from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";
import type { CustomerServiceActionKind } from "@/types/api";

const dateLabel = new Intl.DateTimeFormat(REPORT_LOCALE, {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const actionIcon: Record<CustomerServiceActionKind, IconName> = {
  reply: "paperplane.fill",
  claim: "checkmark.circle",
  release: "tray",
  transfer: "arrow.triangle.2.circlepath",
  takeover: "person.2",
  status: "slider.horizontal.3",
  booking: "calendar",
  note: "doc.text",
  order: "car",
  other: "pencil",
};

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

  const activities = activitiesQuery.data?.pages.flatMap((page) => page.activities) ?? [];

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
                <Text style={{ ...type.title3, ...rtlText, color: colors.text }}>آخر الأنشطة</Text>
                <Text style={{ ...type.footnote, ...rtlText, color: colors.textSecondary }}>
                  اضغطي على أي نشاط لفتح المحادثة المرتبطة به.
                </Text>
              </View>

              {!hasRequestedActivities ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="عرض الأنشطة"
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
                  <Text style={{ ...type.subheadStrong, ...rtlText, color: colors.brand }}>عرض الأنشطة</Text>
                </Pressable>
              ) : activitiesQuery.isLoading ? (
                <ActivityIndicator size="small" color={colors.brand} />
              ) : activitiesQuery.isError ? (
                <Card variant="raised">
                  <View style={{ gap: spacing.sm, alignItems: "center" }}>
                    <Text style={{ ...type.body, ...rtlText, color: colors.danger }}>
                      {activitiesQuery.error.message || "تعذّر تحميل الأنشطة"}
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
                  {activities.length ? (
                    activities.map((activity) => (
                      <Link
                        key={activity.id}
                        href={{ pathname: "/conversation/[id]", params: { id: activity.conversationId } }}
                        asChild
                      >
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`${activity.title}، ${activity.customerName ?? activity.customerPhone ?? "محادثة"}`}
                          style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
                        >
                          <Card>
                            <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.md }}>
                              <IconSymbol name={actionIcon[activity.kind]} size={20} color={colors.brand} />
                              <View style={{ flex: 1, gap: spacing.xs }}>
                                <Text selectable style={{ ...type.bodyStrong, ...rtlText, color: colors.text }}>
                                  {activity.title}
                                </Text>
                                <Text selectable style={{ ...type.footnote, ...rtlText, color: colors.textSecondary }}>
                                  {activity.customerName || activity.customerPhone || "محادثة"} · {relativeTimeLabel(activity.at)}
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
                      لا توجد أنشطة خلال الفترة المختارة.
                    </Text>
                  )}

                  {activitiesQuery.hasNextPage ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="تحميل المزيد من الأنشطة"
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

