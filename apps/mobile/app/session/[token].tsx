import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { Alert, FlatList, Linking, Pressable, RefreshControl, Text, View } from "react-native";

import { PrimaryButton } from "@/components/primary-button";
import { EmptyState, ErrorState, InlineAlert, LoadingScreen } from "@/components/screen-state";
import { Badge } from "@/components/ui/badge";
import { Card, Divider } from "@/components/ui/card";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { hitSize, radius, rtlText, spacing, type } from "@/constants/theme";
import {
  durationLabel,
  formatters,
  locationUrl,
  relativeDayLabel,
  tripTypeLabel,
} from "@/lib/format";
import { successFeedback, tapFeedback } from "@/lib/haptics";
import { useFieldSession, useFieldSessionAction } from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";
import type { FieldSessionRole, FieldSessionVisit } from "@/types/api";

/** Three-step progress rail: booked → started → completed. */
function ProgressRail({ visit }: { visit: FieldSessionVisit }) {
  const { colors } = useTheme();
  const steps = [
    { label: "محجوزة", done: true },
    { label: "بدأت", done: Boolean(visit.state.started_at) },
    { label: "انتهت", done: Boolean(visit.state.completed_at) },
  ];

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={`حالة الزيارة: ${
        visit.state.completed_at ? "انتهت" : visit.state.started_at ? "بدأت" : "محجوزة"
      }`}
      style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.xs }}
    >
      {steps.map((step, index) => (
        <View
          key={step.label}
          style={{ flex: 1, flexDirection: "row-reverse", alignItems: "center", gap: spacing.xs }}
        >
          <View style={{ alignItems: "center", gap: spacing.xs }}>
            <View
              style={{
                width: 18,
                height: 18,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: radius.full,
                borderWidth: step.done ? 0 : 1.5,
                borderColor: colors.borderStrong,
                backgroundColor: step.done ? colors.success : "transparent",
              }}
            >
              {step.done ? <IconSymbol name="checkmark" color={colors.onBrand} size={11} /> : null}
            </View>
            <Text
              style={{
                ...type.caption,
                fontWeight: step.done ? "600" : "400",
                color: step.done ? colors.text : colors.textTertiary,
              }}
            >
              {step.label}
            </Text>
          </View>
          {index < steps.length - 1 ? (
            <View
              style={{
                flex: 1,
                height: 2,
                marginBottom: 18,
                borderRadius: radius.full,
                backgroundColor: steps[index + 1]?.done ? colors.success : colors.border,
              }}
            />
          ) : null}
        </View>
      ))}
    </View>
  );
}

function VisitCard({
  visit,
  role,
  token,
}: {
  visit: FieldSessionVisit;
  role: FieldSessionRole;
  token: string;
}) {
  const { colors } = useTheme();
  const action = useFieldSessionAction(token);

  const counterpart = role === "specialist" ? visit.driverName : visit.specialistName;
  const counterpartLabel = role === "specialist" ? "السائق" : "الأخصائية";
  const activityLabel = role === "specialist" ? "الجلسة" : "الرحلة";
  const pending = action.isPending && action.variables?.orderId === visit.id;
  const done = Boolean(visit.state.completed_at);
  const started = Boolean(visit.state.started_at);

  const runAction = (next: "start" | "complete") => {
    const verb = next === "start" ? "بدء" : "إنهاء";
    Alert.alert(`تأكيد ${verb} ${activityLabel}`, `سيتم تسجيل ${verb} ${activityLabel} الآن.`, [
      { text: "رجوع", style: "cancel" },
      {
        text: "تأكيد",
        onPress: () =>
          action.mutate(
            { orderId: visit.id, action: next },
            { onSuccess: () => successFeedback() },
          ),
      },
    ]);
  };

  return (
    <Card style={{ gap: spacing.lg, opacity: done ? 0.72 : 1 }}>
      <View style={{ flexDirection: "row-reverse", alignItems: "flex-start", gap: spacing.md }}>
        <View style={{ flex: 1, gap: spacing.xs }}>
          <Text selectable style={{ ...type.title3, color: colors.text, ...rtlText }}>
            {visit.customerName || visit.customerPhone}
          </Text>
          <Text
            style={{
              ...type.calloutStrong,
              color: colors.brand,
              fontVariant: ["tabular-nums"],
              ...rtlText,
            }}
          >
            {relativeDayLabel(visit.arrivalAt)} · {formatters.time.format(new Date(visit.arrivalAt))}
          </Text>
        </View>
        {done ? <Badge label={`تم إنهاء ${activityLabel}`} tone="success" icon="checkmark.circle" /> : null}
      </View>

      <ProgressRail visit={visit} />

      <Divider />

      <View style={{ gap: spacing.sm }}>
        <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}>
          <IconSymbol name="clock" color={colors.textTertiary} size={15} />
          <Text style={{ ...type.footnote, color: colors.textSecondary, ...rtlText }}>
            {durationLabel(visit.durationMinutes)} · {tripTypeLabel[visit.tripType]}
          </Text>
        </View>
        {counterpart ? (
          <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}>
            <IconSymbol
              name={role === "specialist" ? "car" : "sparkles"}
              color={colors.textTertiary}
              size={15}
            />
            <Text selectable style={{ ...type.footnote, color: colors.textSecondary, ...rtlText }}>
              {counterpartLabel}: {counterpart}
            </Text>
          </View>
        ) : null}
      </View>

      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`فتح موقع العميلة في الخرائط: ${visit.customerLocation}`}
        onPress={() => {
          tapFeedback();
          void Linking.openURL(locationUrl(visit.customerLocation));
        }}
        style={({ pressed }) => ({
          minHeight: hitSize.comfortable,
          flexDirection: "row-reverse",
          alignItems: "center",
          gap: spacing.sm,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.md,
          borderRadius: radius.md,
          borderCurve: "continuous",
          backgroundColor: pressed ? colors.borderStrong : colors.surfaceSunken,
        })}
      >
        <IconSymbol name="mappin.and.ellipse" color={colors.brand} size={17} />
        <Text
          numberOfLines={2}
          style={{ flex: 1, ...type.footnote, color: colors.text, ...rtlText }}
        >
          {visit.customerLocation}
        </Text>
        <IconSymbol name="chevron.left" color={colors.brand} size={15} />
      </Pressable>

      {action.error ? <InlineAlert message={action.error.message} /> : null}

      {done ? null : started ? (
        <PrimaryButton
          label={`تأكيد انتهاء ${activityLabel}`}
          tone="success"
          icon="checkmark.circle"
          loading={pending}
          onPress={() => runAction("complete")}
        />
      ) : (
        <PrimaryButton
          label={`تأكيد بدء ${activityLabel}`}
          icon="figure.walk"
          loading={pending}
          onPress={() => runAction("start")}
        />
      )}
    </Card>
  );
}

export default function FieldSessionScreen() {
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ token: string | string[] }>();
  const token = useMemo(
    () => (Array.isArray(params.token) ? (params.token[0] ?? "") : (params.token ?? "")),
    [params.token],
  );
  const dashboard = useFieldSession(token);

  if (dashboard.isLoading) return <LoadingScreen label="جارٍ تحميل الجلسات…" />;
  if (dashboard.isError || !dashboard.data) {
    return (
      <ErrorState
        title="تعذر فتح الرابط"
        message={dashboard.error?.message ?? "الرابط غير صحيح أو انتهت صلاحيته."}
        onRetry={() => void dashboard.refetch()}
      />
    );
  }

  const { personName, role, visits } = dashboard.data;
  const remaining = visits.filter((visit) => !visit.state.completed_at).length;

  return (
    <FlatList
      contentInsetAdjustmentBehavior="automatic"
      data={visits}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <VisitCard visit={item} role={role} token={token} />}
      contentContainerStyle={{
        padding: spacing.lg,
        gap: spacing.lg,
        paddingBottom: spacing["3xl"],
        flexGrow: 1,
      }}
      ListHeaderComponent={
        <View style={{ gap: spacing.xs, paddingBottom: spacing.xs }}>
          <Text style={{ ...type.title2, color: colors.text, ...rtlText }}>
            أهلًا {personName}
          </Text>
          <Text style={{ ...type.callout, color: colors.textSecondary, ...rtlText }}>
            {role === "specialist" ? "جلسات الأخصائية" : "رحلات السائق"}
            {remaining > 0 ? ` · ${remaining} متبقية` : " · اكتملت جميع المواعيد"}
          </Text>
        </View>
      }
      ListEmptyComponent={
        <EmptyState
          icon="calendar"
          title="لا توجد جلسات"
          detail="لا توجد زيارات خلال الأيام القادمة."
        />
      }
      refreshControl={
        <RefreshControl
          refreshing={dashboard.isRefetching}
          onRefresh={() => void dashboard.refetch()}
          tintColor={colors.brand}
        />
      }
    />
  );
}
