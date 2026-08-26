import { Link, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo } from "react";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ActionBar, PrimaryButton } from "@/components/primary-button";
import { ErrorState, LoadingScreen } from "@/components/screen-state";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, Divider } from "@/components/ui/card";
import { DetailRow, SectionHeader } from "@/components/ui/detail-row";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { hitSize, radius, rtlText, spacing, type } from "@/constants/theme";
import {
  executionIsStalled,
  executionStateOf,
  ROLE_LABEL,
  stalledLabel,
  type ExecutionStep,
} from "@/lib/execution";
import {
  durationLabel,
  formatPhone,
  formatters,
  locationUrl,
  orderStatusIcon,
  orderStatusLabel,
  orderStatusTone,
  relativeDayLabel,
  telUrl,
  tripTypeLabel,
  whatsappUrl,
} from "@/lib/format";
import { tapFeedback } from "@/lib/haptics";
import { useBootstrap, useOrder } from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";
import type { FieldSessionState } from "@/types/api";

const priceFormatter = new Intl.NumberFormat("ar-SA", {
  style: "currency",
  currency: "SAR",
  maximumFractionDigits: 2,
});

function executionLabel(state: FieldSessionState | undefined, noun: string) {
  if (state?.completed_at) {
    return `اكتملت ${noun} · ${formatters.dateTime.format(new Date(state.completed_at))}`;
  }
  if (state?.started_at) {
    return `${noun} جارية · بدأت ${formatters.dateTime.format(new Date(state.started_at))}`;
  }
  return `لم تبدأ ${noun} بعد`;
}

function wasEdited(createdAt: string, updatedAt?: string | null) {
  if (!updatedAt) return false;
  return new Date(updatedAt).getTime() - new Date(createdAt).getTime() > 1_000;
}

function isDriverLate(
  arrivalAt: string,
  driverId: string | null,
  driverSession?: FieldSessionState,
) {
  if (!driverId || driverSession?.started_at) return false;
  const arrival = new Date(arrivalAt).getTime();
  const now = Date.now();
  return now > arrival + 15 * 60_000 && now < arrival + 6 * 60 * 60_000;
}

/** Compact circular icon action used in the customer hero. */
function QuickAction({
  icon,
  label,
  onPress,
}: {
  icon: "phone" | "message" | "mappin.and.ellipse";
  label: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        tapFeedback();
        onPress();
      }}
      style={({ pressed }) => ({
        alignItems: "center",
        gap: spacing.xs,
        minWidth: 64,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View
        style={{
          width: hitSize.min,
          height: hitSize.min,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: radius.full,
          backgroundColor: colors.brandSoft,
        }}
      >
        <IconSymbol name={icon} color={colors.onBrandSoft} size={19} />
      </View>
      <Text style={{ ...type.caption, fontWeight: "400", color: colors.textSecondary }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Five dots and their labels — the whole chain at a glance. */
function StepRail({ steps }: { steps: ExecutionStep[] }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row-reverse", alignItems: "flex-start", gap: spacing.xs }}>
      {steps.map((step) => (
        <View key={step.id} style={{ flex: 1, alignItems: "center", gap: spacing.xs }}>
          <View
            style={{
              width: 22,
              height: 22,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: radius.full,
              borderWidth: step.done ? 0 : step.current ? 2 : 1,
              borderColor: step.current ? colors.brand : colors.borderStrong,
              backgroundColor: step.done ? colors.success : colors.surface,
            }}
          >
            {step.done ? (
              <IconSymbol name="checkmark" size={12} color={colors.onBrand} />
            ) : null}
          </View>
          <Text
            numberOfLines={2}
            style={{
              ...type.caption,
              textAlign: "center",
              color: step.done || step.current ? colors.text : colors.textTertiary,
            }}
          >
            {step.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Assignment card — shows who is booked, or that nobody is. */
function AssignmentCard({
  role,
  name,
  icon,
}: {
  role: string;
  name: string | null;
  icon: "sparkles" | "car";
}) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flex: 1,
        gap: spacing.sm,
        padding: spacing.md,
        borderRadius: radius.lg,
        borderCurve: "continuous",
        borderWidth: 1,
        borderStyle: name ? "solid" : "dashed",
        borderColor: name ? colors.border : colors.borderStrong,
        backgroundColor: name ? colors.surface : "transparent",
      }}
    >
      <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.xs + 2 }}>
        <IconSymbol name={icon} color={colors.textTertiary} size={14} />
        <Text style={{ ...type.caption, color: colors.textTertiary, ...rtlText }}>{role}</Text>
      </View>
      {name ? (
        <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}>
          <Avatar name={name} seed={name} size={30} />
          <Text
            numberOfLines={1}
            selectable
            style={{ flex: 1, ...type.calloutStrong, color: colors.text, ...rtlText }}
          >
            {name}
          </Text>
        </View>
      ) : (
        <Text style={{ ...type.callout, color: colors.textTertiary, ...rtlText }}>
          لم يتم التحديد
        </Text>
      )}
    </View>
  );
}

export default function OrderDetailScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = useMemo(
    () => (Array.isArray(params.id) ? (params.id[0] ?? "") : (params.id ?? "")),
    [params.id],
  );
  const detail = useOrder(id);
  const bootstrap = useBootstrap();

  if (detail.isLoading) return <LoadingScreen label="جارٍ تحميل الطلب…" />;
  if (detail.isError || !detail.data) {
    return (
      <ErrorState
        title="تعذر تحميل الطلب"
        message={detail.error?.message ?? "الطلب غير موجود"}
        onRetry={() => void detail.refetch()}
      />
    );
  }

  const order = detail.data.order;
  const arrival = new Date(order.arrival_at);
  const ready = Boolean(order.specialist_id && order.driver_id);
  const driverLate = isDriverLate(order.arrival_at, order.driver_id, order.driver_session);
  const execution = executionStateOf(order);
  const stalled = executionIsStalled(execution);
  const edited = wasEdited(order.created_at, order.updated_at);
  const canViewPrice = bootstrap.data?.capabilities.canViewOrderPrices === true;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          padding: spacing.lg,
          gap: spacing.lg,
          paddingBottom: spacing["3xl"],
        }}
      >
        {/* Customer hero */}
        <Card>
          <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.md }}>
            <Avatar name={order.customer_name} seed={order.customer_phone} size={52} />
            <View style={{ flex: 1, gap: spacing.xs }}>
              <Text
                selectable
                numberOfLines={2}
                style={{ ...type.title3, color: colors.text, ...rtlText }}
              >
                {order.customer_name || "عميلة بدون اسم"}
              </Text>
              <Text
                selectable
                style={{
                  ...type.footnote,
                  color: colors.textSecondary,
                  fontVariant: ["tabular-nums"],
                  ...rtlText,
                }}
              >
                {formatPhone(order.customer_phone)}
              </Text>
            </View>
            <Badge
              label={orderStatusLabel[order.status]}
              tone={orderStatusTone[order.status]}
              icon={orderStatusIcon[order.status] as "clock"}
            />
          </View>

          <Divider />

          <View
            style={{
              flexDirection: "row-reverse",
              justifyContent: "space-around",
              paddingTop: spacing.xs,
            }}
          >
            <QuickAction
              icon="phone"
              label="اتصال"
              onPress={() => void Linking.openURL(telUrl(order.customer_phone))}
            />
            <QuickAction
              icon="message"
              label="واتساب"
              onPress={() => void Linking.openURL(whatsappUrl(order.customer_phone))}
            />
            <QuickAction
              icon="mappin.and.ellipse"
              label="الموقع"
              onPress={() => void Linking.openURL(locationUrl(order.customer_location))}
            />
          </View>
        </Card>

        {/* On-demand AI read of the same customer conversation used on web. */}
        <Card
          variant="raised"
          style={{ backgroundColor: colors.brandSoft, borderColor: colors.brandSoft }}
        >
          <View style={{ flexDirection: "row-reverse", alignItems: "flex-start", gap: spacing.md }}>
            <View
              style={{
                width: hitSize.min,
                height: hitSize.min,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: radius.full,
                backgroundColor: colors.surface,
              }}
            >
              <IconSymbol name="sparkles" color={colors.brand} size={20} />
            </View>
            <View style={{ flex: 1, gap: spacing.xs }}>
              <Text selectable style={{ ...type.headline, color: colors.onBrandSoft, ...rtlText }}>
                تحليل AI لرضا العميلة
              </Text>
              <Text selectable style={{ ...type.footnote, color: colors.onBrandSoft, ...rtlText }}>
                يحلل المحادثة والحجوزات السابقة ويعرض مستوى الرضا، جودة التواصل، والتنبيهات والتوصيات.
              </Text>
            </View>
          </View>
          <PrimaryButton
            label="تشغيل التحليل الذكي"
            icon="sparkles"
            variant="outline"
            silent
            onPress={() => router.push({ pathname: "/orders/[id]/analysis", params: { id } })}
          />
        </Card>

        {/* Appointment */}
        <View style={{ gap: spacing.sm }}>
          <SectionHeader title="تفاصيل الموعد" />
          <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
            <DetailRow
              icon="calendar"
              label="موعد الوصول"
              monospacedValue
              value={`${relativeDayLabel(order.arrival_at)} · ${formatters.time.format(arrival)}`}
            />
            <Divider inset={46} />
            <DetailRow
              icon="clock"
              label="مدة الجلسة"
              value={durationLabel(order.duration_minutes)}
            />
            <Divider inset={46} />
            <DetailRow
              icon="car"
              label="نوع الرحلة"
              value={tripTypeLabel[order.trip_type]}
            />
            <Divider inset={46} />
            <DetailRow
              icon="mappin.and.ellipse"
              label="موقع العميلة"
              value={order.customer_location}
              actionIcon="chevron.left"
              actionLabel={`فتح موقع العميلة في الخرائط: ${order.customer_location}`}
              onPress={() => void Linking.openURL(locationUrl(order.customer_location))}
            />
          </Card>
        </View>

        {/* Assignments */}
        <View style={{ gap: spacing.sm }}>
          <SectionHeader title="فريق التنفيذ" />
          <View style={{ flexDirection: "row-reverse", gap: spacing.md }}>
            <AssignmentCard role="الأخصائية" icon="sparkles" name={order.specialist_name} />
            <AssignmentCard role="السائق" icon="car" name={order.driver_name} />
          </View>
          {!ready ? (
            <View
              style={{
                flexDirection: "row-reverse",
                alignItems: "center",
                gap: spacing.sm,
                padding: spacing.md,
                borderRadius: radius.md,
                backgroundColor: colors.warningSoft,
              }}
            >
              <IconSymbol name="exclamationmark.triangle" color={colors.onWarningSoft} size={16} />
              <Text style={{ flex: 1, ...type.footnote, color: colors.onWarningSoft, ...rtlText }}>
                لا يمكن تأكيد الإرسال قبل تحديد الأخصائية والسائق.
              </Text>
            </View>
          ) : null}
          {order.driver_phone ? (
            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
              <DetailRow
                icon="phone"
                label="رقم السائق"
                value={formatPhone(order.driver_phone)}
                monospacedValue
                actionIcon="phone"
                actionLabel={`اتصال بالسائق على ${order.driver_phone}`}
                onPress={() => void Linking.openURL(telUrl(order.driver_phone!))}
              />
            </Card>
          ) : null}
        </View>

        {/* Field progress. The two legacy session rows stay — they are the
            coarse truth for orders raised before the in-app workflow — but the
            live step machine leads, and both open the full timeline. */}
        <View style={{ gap: spacing.sm }}>
          <SectionHeader title="حالة التنفيذ" />
          {driverLate ? (
            <View
              style={{
                flexDirection: "row-reverse",
                alignItems: "center",
                gap: spacing.sm,
                padding: spacing.md,
                borderRadius: radius.md,
                backgroundColor: colors.dangerSoft,
              }}
            >
              <IconSymbol name="exclamationmark.triangle" color={colors.onDangerSoft} size={16} />
              <Text selectable style={{ flex: 1, ...type.footnote, color: colors.onDangerSoft, ...rtlText }}>
                السائق متأخر أكثر من ١٥ دقيقة ولم يؤكد بدء الرحلة.
              </Text>
            </View>
          ) : null}
          <Card style={{ gap: spacing.md }}>
            <View
              style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}
            >
              <Text style={{ flex: 1, ...type.headline, color: colors.text, ...rtlText }}>
                {execution.label}
              </Text>
              <Badge
                label={
                  execution.tracked
                    ? execution.pendingRole
                      ? `بانتظار ${ROLE_LABEL[execution.pendingRole]}`
                      : "مكتمل"
                    : "لم يبدأ"
                }
                tone={stalled ? "danger" : execution.tone}
                icon={execution.stage === "completed" ? "checkmark.circle" : "clock"}
              />
            </View>
            {execution.pendingLabel ? (
              <Text
                selectable
                style={{ ...type.footnote, color: colors.textSecondary, ...rtlText }}
              >
                {`الخطوة المطلوبة: ${execution.pendingLabel}` +
                  (execution.stalledMinutes != null
                    ? ` · بدون تحديث منذ ${stalledLabel(execution.stalledMinutes)}`
                    : "")}
              </Text>
            ) : null}
            <StepRail steps={execution.steps} />
            <PrimaryButton
              label="متابعة التنفيذ وإرسال تذكير"
              icon="figure.walk"
              variant="outline"
              silent
              onPress={() => router.push({ pathname: "/orders/[id]/status", params: { id } })}
            />
          </Card>
          <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
            <DetailRow
              icon="car"
              label="رحلة السائق"
              value={executionLabel(order.driver_session, "الرحلة")}
              tone={order.driver_session?.started_at ? "default" : "muted"}
            />
            <Divider inset={46} />
            <DetailRow
              icon="sparkles"
              label="جلسة الأخصائية"
              value={executionLabel(order.specialist_session, "الجلسة")}
              tone={order.specialist_session?.started_at ? "default" : "muted"}
            />
          </Card>
        </View>

        {/* Commercial and audit fields returned by the web order enrichment. */}
        <View style={{ gap: spacing.sm }}>
          <SectionHeader title="بيانات الطلب" />
          <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
            {canViewPrice ? (
              <>
                <DetailRow
                  icon="banknote"
                  label="أجرة السائق"
                  value={order.price == null ? "غير محددة" : priceFormatter.format(order.price)}
                  monospacedValue
                />
                <Divider inset={46} />
              </>
            ) : null}
            <DetailRow
              icon="calendar"
              label="تاريخ إنشاء الطلب"
              value={formatters.dateTime.format(new Date(order.created_at))}
              monospacedValue
            />
            <Divider inset={46} />
            <DetailRow
              icon="paperplane.fill"
              label="تاريخ الإرسال"
              value={
                order.sent_at
                  ? formatters.dateTime.format(new Date(order.sent_at))
                  : "لم يُرسل بعد"
              }
              monospacedValue={Boolean(order.sent_at)}
              tone={order.sent_at ? "default" : "muted"}
            />
            {edited ? (
              <>
                <Divider inset={46} />
                <DetailRow
                  icon="pencil"
                  label={order.updated_by_name ? `آخر تعديل بواسطة ${order.updated_by_name}` : "آخر تعديل"}
                  value={formatters.dateTime.format(new Date(order.updated_at!))}
                  monospacedValue
                />
              </>
            ) : null}
          </Card>
        </View>
      </ScrollView>

      <ActionBar bottomInset={insets.bottom}>
        <PrimaryButton
          label="طلب سائق وتأكيد الإرسال"
          icon="paperplane.fill"
          onPress={() => router.push({ pathname: "/orders/[id]/dispatch", params: { id } })}
        />
        <Link href={{ pathname: "/orders/[id]/edit", params: { id } }} asChild>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="تعديل بيانات الطلب"
            style={({ pressed }) => ({
              minHeight: hitSize.control,
              flexDirection: "row-reverse",
              alignItems: "center",
              justifyContent: "center",
              gap: spacing.sm,
              borderRadius: radius.lg,
              borderCurve: "continuous",
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <IconSymbol name="pencil" color={colors.brand} size={17} />
            <Text style={{ ...type.bodyStrong, color: colors.brand, ...rtlText }}>
              تعديل بيانات الطلب
            </Text>
          </Pressable>
        </Link>
      </ActionBar>
    </View>
  );
}
