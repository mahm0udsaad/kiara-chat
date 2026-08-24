import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { Alert, Linking, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ActionBar, PrimaryButton } from "@/components/primary-button";
import { ErrorState, InlineAlert, LoadingScreen } from "@/components/screen-state";
import { Badge } from "@/components/ui/badge";
import { Card, Divider } from "@/components/ui/card";
import { DetailRow, SectionHeader } from "@/components/ui/detail-row";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { radius, rtlText, spacing, type } from "@/constants/theme";
import {
  durationLabel,
  formatPhone,
  formatters,
  locationUrl,
  relativeDayLabel,
  telUrl,
  tripTypeLabel,
} from "@/lib/format";
import { successFeedback } from "@/lib/haptics";
import { useFieldOrder, useFieldOrderAction } from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";
import type { FieldOrder, FieldOrderAction } from "@/types/api";

const STEP_LABELS = ["تأكيد الرحلة", "ركوب الأخصائية", "بدء الخدمة", "إنهاء الخدمة", "عودة السائق"];

function ProgressRail({ order }: { order: FieldOrder }) {
  const { colors } = useTheme();
  const done = [
    Boolean(order.progress.driverConfirmedAt),
    Boolean(order.progress.specialistPickupAt),
    Boolean(order.progress.serviceStartedAt),
    Boolean(order.progress.completedAt),
    Boolean(order.progress.driverReturnedAt),
  ];
  return (
    <View style={{ flexDirection: "row-reverse", alignItems: "flex-start", gap: spacing.xs }}>
      {STEP_LABELS.map((label, index) => (
        <View key={label} style={{ flex: 1, alignItems: "center", gap: spacing.xs }}>
          <View
            style={{
              width: 24,
              height: 24,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: radius.full,
              borderWidth: done[index] ? 0 : 1,
              borderColor: colors.borderStrong,
              backgroundColor: done[index] ? colors.success : colors.surface,
            }}
          >
            {done[index] ? (
              <IconSymbol name="checkmark" size={13} color={colors.onBrand} />
            ) : (
              <Text style={{ ...type.caption, color: colors.textTertiary }}>{index + 1}</Text>
            )}
          </View>
          <Text
            numberOfLines={2}
            style={{ ...type.caption, textAlign: "center", color: done[index] ? colors.text : colors.textTertiary }}
          >
            {label}
          </Text>
        </View>
      ))}
    </View>
  );
}

const confirmationText: Record<FieldOrderAction, { title: string; body: string }> = {
  confirm_ride: { title: "تأكيد الرحلة والانطلاق", body: "أؤكد أنني انطلقت لاصطحاب الأخصائية." },
  driver_arrived: { title: "وصلت لمقر الأخصائية", body: "سيتم تنبيه الأخصائية بوصولك الآن." },
  confirm_pickup: { title: "ركبتُ مع السائق", body: "أؤكد ركوبي مع السائق والتوجه إلى العميلة." },
  start_service: { title: "بدء الخدمة", body: "أؤكد وصولي إلى منزل العميلة وبدء الخدمة الآن." },
  complete_order: { title: "إنهاء الخدمة والمغادرة", body: "أؤكد انتهاء الخدمة ومغادرتي منزل العميلة." },
  driver_return: { title: "إنهاء الرحلة والعودة", body: "أؤكد عودتي وإتمام رحلة هذا الطلب." },
};

export default function FieldOrderDetailScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = useMemo(() => (Array.isArray(params.id) ? params.id[0] ?? "" : params.id ?? ""), [params.id]);
  const detail = useFieldOrder(id);
  const action = useFieldOrderAction(id);
  if (detail.isLoading) return <LoadingScreen label="جارٍ تحميل الطلب…" />;
  if (detail.isError || !detail.data) {
    return <ErrorState title="تعذر تحميل الطلب" message={detail.error?.message ?? "الطلب غير موجود"} onRetry={() => void detail.refetch()} />;
  }
  const order = detail.data.order;
  const next = order.nextAction;
  const confirm = () => {
    if (!next) return;
    const copy = confirmationText[next];
    Alert.alert(copy.title, copy.body, [
      { text: "رجوع", style: "cancel" },
      {
        text: "تأكيد",
        onPress: () =>
          action.mutate(
            { action: next, expectedVersion: order.progress.version },
            { onSuccess: () => successFeedback() },
          ),
      },
    ]);
  };
  // The driver's non-blocking "I've arrived" ping — fires straight away and
  // just notifies the specialist; it never gates her next step.
  const pingArrival = () =>
    action.mutate(
      { action: "driver_arrived", expectedVersion: order.progress.version },
      { onSuccess: () => successFeedback() },
    );
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing["4xl"] }}
      >
        <Card style={{ gap: spacing.lg }}>
          <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.md }}>
            <View style={{ flex: 1, gap: spacing.xs }}>
              <Text style={{ ...type.title2, color: colors.text, ...rtlText }}>
                {order.customerName || "العميلة"}
              </Text>
              <Text selectable style={{ ...type.footnote, color: colors.textSecondary, ...rtlText }}>
                {formatPhone(order.customerPhone)}
              </Text>
            </View>
            <Badge
              label={order.progress.driverReturnedAt ? "مكتمل" : order.canAct ? "بانتظارك" : "بانتظار الخطوة التالية"}
              tone={order.progress.driverReturnedAt ? "success" : order.canAct ? "warning" : "neutral"}
              icon={order.progress.driverReturnedAt ? "checkmark.circle" : "clock"}
            />
          </View>
          <Divider />
          <ProgressRail order={order} />
        </Card>

        <View style={{ gap: spacing.sm }}>
          <SectionHeader title="تفاصيل الطلب" />
          <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
            <DetailRow icon="calendar" label="الموعد" value={`${relativeDayLabel(order.arrivalAt)} · ${formatters.time.format(new Date(order.arrivalAt))}`} />
            <Divider inset={46} />
            <DetailRow icon="clock" label="مدة الخدمة" value={durationLabel(order.durationMinutes)} />
            <Divider inset={46} />
            <DetailRow icon="car" label="نوع الرحلة" value={tripTypeLabel[order.tripType]} />
            <Divider inset={46} />
            <DetailRow
              icon="mappin.and.ellipse"
              label="موقع العميلة"
              value={order.customerLocation}
              actionIcon="chevron.left"
              actionLabel="فتح الموقع"
              onPress={() => void Linking.openURL(locationUrl(order.customerLocation))}
            />
          </Card>
        </View>

        <View style={{ gap: spacing.sm }}>
          <SectionHeader title="فريق الطلب" />
          <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
            <DetailRow icon="sparkles" label="الأخصائية" value={order.specialistName ?? "غير محددة"} />
            <Divider inset={46} />
            <DetailRow icon="car" label="السائق" value={order.driverName ?? "غير محدد"} />
          </Card>
        </View>

        <View
          style={{
            flexDirection: "row-reverse",
            alignItems: "flex-start",
            gap: spacing.sm,
            padding: spacing.md,
            borderRadius: radius.md,
            backgroundColor: colors.brandSoft,
          }}
        >
          <IconSymbol name="bell" size={17} color={colors.onBrandSoft} />
          <Text style={{ flex: 1, ...type.footnote, color: colors.onBrandSoft, ...rtlText }}>
            إذا بقيت الخطوة المطلوبة دون تفاعل لمدة 30 دقيقة فسيصل تذكير تلقائي.
          </Text>
        </View>
        {action.error ? <InlineAlert message={action.error.message} /> : null}
      </ScrollView>

      <ActionBar bottomInset={insets.bottom}>
        {order.canPingArrival ? (
          <PrimaryButton
            label="وصلت لمقر الأخصائية"
            icon="mappin.and.ellipse"
            loading={action.isPending}
            onPress={pingArrival}
          />
        ) : null}
        {next && order.canAct ? (
          <PrimaryButton label={order.nextActionLabel ?? "تأكيد الخطوة"} icon="checkmark.circle" loading={action.isPending} onPress={confirm} />
        ) : next ? (
          <PrimaryButton label={order.nextActionLabel ?? "بانتظار الخطوة التالية"} icon="hourglass" variant="tinted" disabled onPress={() => undefined} />
        ) : (
          <PrimaryButton label="تم إنهاء الطلب" icon="checkmark.circle" tone="success" variant="tinted" disabled onPress={() => undefined} />
        )}
        <PrimaryButton label="اتصال بالعميلة" icon="phone" variant="plain" onPress={() => void Linking.openURL(telUrl(order.customerPhone))} />
      </ActionBar>
    </View>
  );
}
