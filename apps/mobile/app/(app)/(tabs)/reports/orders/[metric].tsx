import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";

import { OutcomeRow, ProblemRow } from "@/components/reports/orders-summary";
import { ErrorState } from "@/components/screen-state";
import { Card, Divider } from "@/components/ui/card";
import { numeric, rtlText, spacing, type } from "@/constants/theme";
import { REPORT_LOCALE, reportInteger } from "@/lib/operations-report";
import { useBootstrap, useOrdersReport } from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";
import type { OrderProblemKind } from "@/types/api";

type OrderMetric = "problems" | "late" | "service-overrun" | "missing-trip-cost" | "not-done";

const METRIC_DETAILS: Record<OrderMetric, { title: string; description: string; kind?: OrderProblemKind }> = {
  problems: {
    title: "طلبات تحتاج مراجعة",
    description: "كل الطلبات التي ظهر فيها تأخر أو تجاوز للوقت أو تكلفة مشوار ناقصة أو عدم تنفيذ.",
  },
  late: {
    title: "طلبات بدأت متأخرة",
    description: "الطلبات التي سُجل بدء خدمتها بعد الموعد المحدد.",
    kind: "late",
  },
  "service-overrun": {
    title: "طلبات تجاوزت وقت الخدمة",
    description: "الطلبات التي استغرق تنفيذها وقتاً أطول من المدة المحجوزة.",
    kind: "service_overrun",
  },
  "missing-trip-cost": {
    title: "تكلفة مشوار ناقصة",
    description: "الطلبات التي تحتاج تسجيل تكلفة مشوار السائق.",
    kind: "missing_trip_cost",
  },
  "not-done": {
    title: "طلبات لم يتم تنفيذها",
    description: "الطلبات التي أنهى الفريق متابعتها على أنها لم تُنفذ، مع الملاحظة المسجلة.",
  },
};

const periodLabel = new Intl.DateTimeFormat(REPORT_LOCALE, {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function asMetric(value: string): OrderMetric {
  return value in METRIC_DETAILS ? value as OrderMetric : "problems";
}

export default function OrdersMetricDetailsScreen() {
  const params = useLocalSearchParams<{
    metric?: string | string[];
    from?: string | string[];
    to?: string | string[];
  }>();
  const metric = asMetric(one(params.metric));
  const from = one(params.from);
  const to = one(params.to);
  const details = METRIC_DETAILS[metric];
  const bootstrap = useBootstrap();
  const canViewReports = bootstrap.data?.capabilities.canViewReports === true;
  const report = useOrdersReport(from, to, canViewReports);
  const { colors } = useTheme();

  if (bootstrap.isSuccess && !canViewReports) return <Redirect href="/inbox" />;
  if (report.isError) {
    return (
      <ErrorState
        title="تعذّر تحميل تفاصيل الطلبات"
        message={report.error.message}
        onRetry={() => void report.refetch()}
      />
    );
  }

  const problems = metric === "problems"
    ? report.data?.problems ?? []
    : metric === "not-done"
      ? []
      : (report.data?.problems ?? []).filter((problem) => details.kind && problem.kinds.includes(details.kind));
  const outcomes = metric === "not-done"
    ? (report.data?.outcomes ?? []).filter((outcome) => outcome.outcome === "not_done")
    : [];
  const count = metric === "not-done" ? outcomes.length : problems.length;

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
          <Text style={{ ...type.headline, ...rtlText, color: colors.text }}>{details.title}</Text>
          <Text style={{ ...type.body, ...rtlText, color: colors.textSecondary }}>{details.description}</Text>
          <Text selectable style={{ ...type.title2, ...numeric, ...rtlText, color: colors.brand }}>
            {reportInteger.format(count)}
          </Text>
          {from && to ? (
            <Text selectable style={{ ...type.caption, ...numeric, ...rtlText, color: colors.textTertiary }}>
              {periodLabel.format(new Date(`${from}T12:00:00+03:00`))} – {periodLabel.format(new Date(`${to}T12:00:00+03:00`))}
            </Text>
          ) : null}
        </Card>

        {report.isLoading ? <ActivityIndicator size="large" color={colors.brand} /> : null}

        {report.data && count ? (
          <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
            {metric === "not-done"
              ? outcomes.map((outcome, index) => (
                <View key={outcome.orderId}>
                  {index ? <Divider /> : null}
                  <OutcomeRow outcome={outcome} />
                </View>
              ))
              : problems.map((problem, index) => (
                <View key={problem.orderId}>
                  {index ? <Divider /> : null}
                  <ProblemRow problem={problem} />
                </View>
              ))}
          </Card>
        ) : report.data ? (
          <Card>
            <Text style={{ ...type.body, ...rtlText, color: colors.textSecondary }}>
              لا توجد طلبات ضمن هذه النتيجة في الفترة المختارة.
            </Text>
          </Card>
        ) : null}
      </ScrollView>
    </>
  );
}
