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
import { useOrder } from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";

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
