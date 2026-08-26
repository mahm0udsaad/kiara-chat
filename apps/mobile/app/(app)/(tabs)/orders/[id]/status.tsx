import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo } from "react";
import { Linking, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";

import { PrimaryButton } from "@/components/primary-button";
import { ErrorState, InlineAlert, LoadingScreen } from "@/components/screen-state";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, Divider } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/detail-row";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { hitSize, radius, rtlText, spacing, type } from "@/constants/theme";
import {
  executionIsStalled,
  executionStateOf,
  ROLE_LABEL,
  stalledLabel,
  type ExecutionState,
  type ExecutionStep,
} from "@/lib/execution";
import { formatters, relativeDayLabel, telUrl, whatsappUrl } from "@/lib/format";
import { useOrder, useOrderReminder } from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";
import type { FieldSessionRole, OrderReminderRecipient } from "@/types/api";

/**
 * The office's view of a visit that is already out on the road.
 *
 * Everything here is read-only except the two reminder buttons: the office
 * cannot advance a step on the field team's behalf — only the person doing the
 * work may say they did it — so the one action this screen offers is asking
 * them to.
 */

/** One link of the chain, with its timestamp and who owes it. */
function TimelineRow({
  step,
  isLast,
  driverName,
  specialistName,
}: {
  step: ExecutionStep;
  isLast: boolean;
  driverName: string | null;
  specialistName: string | null;
}) {
  const { colors } = useTheme();
  const owner = step.owner === "driver" ? driverName : specialistName;
  const tone = step.done
    ? colors.success
    : step.current
      ? colors.brand
      : colors.borderStrong;

  return (
    <View style={{ flexDirection: "row-reverse", gap: spacing.md }}>
      {/* Rail: the dot for this step and the line down to the next one. */}
      <View style={{ alignItems: "center", width: 26 }}>
        <View
          style={{
            width: 26,
            height: 26,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: radius.full,
            borderWidth: step.done ? 0 : 2,
            borderColor: tone,
            backgroundColor: step.done ? colors.success : colors.surface,
          }}
        >
          {step.done ? (
            <IconSymbol name="checkmark" size={14} color={colors.onBrand} />
          ) : step.current ? (
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: radius.full,
                backgroundColor: colors.brand,
              }}
            />
          ) : null}
        </View>
        {!isLast ? (
          <View
            style={{
              flex: 1,
              width: 2,
              minHeight: spacing.lg,
              backgroundColor: step.done ? colors.success : colors.border,
            }}
          />
        ) : null}
      </View>

      <View style={{ flex: 1, gap: 2, paddingBottom: isLast ? 0 : spacing.lg }}>
        <View
          style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}
        >
          <Text
            style={{
              ...type.calloutStrong,
              color: step.done || step.current ? colors.text : colors.textTertiary,
              ...rtlText,
            }}
          >
            {step.label}
          </Text>
          {step.current ? <Badge label="الخطوة الحالية" tone="brand" icon="clock" /> : null}
        </View>
        <Text
          selectable={step.done}
          style={{
            ...type.footnote,
            color: colors.textSecondary,
            fontVariant: ["tabular-nums"],
            ...rtlText,
          }}
        >
          {step.at
            ? formatters.dateTime.format(new Date(step.at))
            : `بانتظار ${owner || ROLE_LABEL[step.owner]}`}
        </Text>
      </View>
    </View>
  );
}

/** Who can be nudged, how, and the button that opens the composer. */
function RecipientCard({
  role,
  name,
  phone,
  recipient,
  execution,
  onRemind,
}: {
  role: FieldSessionRole;
  name: string | null;
  phone: string | null;
  recipient: OrderReminderRecipient | undefined;
  execution: ExecutionState;
  onRemind: () => void;
}) {
  const { colors } = useTheme();
  const pending = execution.pendingRole === role;
  const contactPhone = recipient?.phone ?? phone;

  if (!name) {
    return (
      <Card style={{ gap: spacing.sm }}>
        <View
          style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}
        >
          <IconSymbol
            name={role === "driver" ? "car" : "sparkles"}
            color={colors.textTertiary}
            size={16}
          />
          <Text style={{ ...type.calloutStrong, color: colors.text, ...rtlText }}>
            {ROLE_LABEL[role]}
          </Text>
        </View>
        <Text style={{ ...type.footnote, color: colors.textTertiary, ...rtlText }}>
          لم يتم التحديد لهذا الطلب.
        </Text>
      </Card>
    );
  }

  return (
    <Card style={{ gap: spacing.md }}>
      <View
        style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.md }}
      >
        <Avatar name={name} seed={name} size={38} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text numberOfLines={1} style={{ ...type.calloutStrong, color: colors.text, ...rtlText }}>
            {name}
          </Text>
          <Text style={{ ...type.caption, color: colors.textTertiary, ...rtlText }}>
            {ROLE_LABEL[role]}
          </Text>
        </View>
        <Badge
          label={pending ? "مطلوب منه إجراء" : "لا إجراء مطلوب"}
          tone={pending ? "warning" : "neutral"}
          icon={pending ? "clock" : "checkmark.circle"}
        />
      </View>

      {pending && execution.pendingLabel ? (
        <Text style={{ ...type.footnote, color: colors.textSecondary, ...rtlText }}>
          {`الخطوة المطلوبة: ${execution.pendingLabel}`}
        </Text>
      ) : null}

      {/* What a reminder can actually travel on. Told up front, because an
          employee who taps "تذكير" for someone with no app and no number
          should learn that here, not on the send button. */}
      <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: spacing.xs + 2 }}>
        <Badge
          label={recipient?.canPush ? "إشعار التطبيق متاح" : "لا يوجد جهاز مسجّل"}
          tone={recipient?.canPush ? "success" : "neutral"}
          icon="bell"
        />
        <Badge
          label={recipient?.canWhatsapp ? "واتساب متاح" : "واتساب غير متاح"}
          tone={recipient?.canWhatsapp ? "success" : "neutral"}
          icon="message"
        />
      </View>

      <Divider />

      <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <PrimaryButton
            label="إرسال تذكير"
            icon="bell"
            variant={pending ? "filled" : "outline"}
            silent
            onPress={onRemind}
          />
        </View>
        {contactPhone ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`اتصال بـ${name}`}
              onPress={() => void Linking.openURL(telUrl(contactPhone))}
              style={({ pressed }) => ({
                width: hitSize.min,
                height: hitSize.min,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: radius.full,
                backgroundColor: colors.brandSoft,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <IconSymbol name="phone" color={colors.onBrandSoft} size={18} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`محادثة واتساب مع ${name}`}
              onPress={() => void Linking.openURL(whatsappUrl(contactPhone))}
              style={({ pressed }) => ({
                width: hitSize.min,
                height: hitSize.min,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: radius.full,
                backgroundColor: colors.brandSoft,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <IconSymbol name="message" color={colors.onBrandSoft} size={18} />
            </Pressable>
          </>
        ) : null}
      </View>
    </Card>
  );
}

export default function OrderStatusScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = useMemo(
    () => (Array.isArray(params.id) ? (params.id[0] ?? "") : (params.id ?? "")),
    [params.id],
  );

  const detail = useOrder(id);
  const reminder = useOrderReminder(id);

  if (detail.isLoading) return <LoadingScreen label="جارٍ تحميل حالة التنفيذ…" />;
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
  const execution = executionStateOf(order);
  const stalled = executionIsStalled(execution);
  const context = reminder.data?.reminder;
  const recipientOf = (role: FieldSessionRole) =>
    context?.recipients.find((person) => person.role === role);

  const openComposer = (role: FieldSessionRole) =>
    router.push({ pathname: "/orders/[id]/remind", params: { id, role } });

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{
        padding: spacing.lg,
        gap: spacing.lg,
        paddingBottom: spacing["3xl"],
      }}
      refreshControl={
        <RefreshControl
          refreshing={detail.isRefetching || reminder.isRefetching}
          onRefresh={() => {
            void detail.refetch();
            void reminder.refetch();
          }}
          tintColor={colors.brand}
        />
      }
    >
      {/* Where the visit stands, in one line. */}
      <Card style={{ gap: spacing.md }}>
        <View
          style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.md }}
        >
          <View style={{ flex: 1, gap: spacing.xs }}>
            <Text numberOfLines={1} style={{ ...type.title3, color: colors.text, ...rtlText }}>
              {order.customer_name || order.customer_phone}
            </Text>
            <Text
              style={{
                ...type.footnote,
                color: colors.textSecondary,
                fontVariant: ["tabular-nums"],
                ...rtlText,
              }}
            >
              {`${relativeDayLabel(order.arrival_at)} · ${formatters.time.format(
                new Date(order.arrival_at),
              )}`}
            </Text>
          </View>
          <Badge
            label={execution.label}
            tone={execution.tone}
            icon={
              execution.stage === "completed"
                ? "checkmark.circle"
                : execution.stage === "not_dispatched"
                  ? "hourglass"
                  : "clock"
            }
          />
        </View>

        {execution.pendingRole && execution.pendingLabel ? (
          <View
            style={{
              flexDirection: "row-reverse",
              alignItems: "center",
              gap: spacing.sm,
              padding: spacing.md,
              borderRadius: radius.md,
              backgroundColor: stalled ? colors.dangerSoft : colors.surfaceSunken,
            }}
          >
            <IconSymbol
              name={stalled ? "exclamationmark.triangle" : "clock"}
              color={stalled ? colors.onDangerSoft : colors.textSecondary}
              size={16}
            />
            <Text
              style={{
                flex: 1,
                ...type.footnote,
                color: stalled ? colors.onDangerSoft : colors.textSecondary,
                ...rtlText,
              }}
            >
              {`بانتظار ${ROLE_LABEL[execution.pendingRole]}: ${execution.pendingLabel}` +
                (execution.stalledMinutes != null
                  ? ` · بدون تحديث منذ ${stalledLabel(execution.stalledMinutes)}`
                  : "")}
            </Text>
          </View>
        ) : null}

        {execution.driverWaiting ? (
          <InlineAlert
            tone="info"
            message="أبلغ السائق بوصوله إلى الأخصائية، وهي لم تؤكد الركوب بعد."
          />
        ) : null}

        {!execution.tracked ? (
          <InlineAlert
            tone="warning"
            message="لم يبدأ تنفيذ هذا الطلب في التطبيق بعد. أكّدي الإرسال أولاً حتى تظهر الخطوات هنا."
          />
        ) : null}

        {context?.lastReminderAt ? (
          <Text style={{ ...type.caption, color: colors.textTertiary, ...rtlText }}>
            {`آخر تذكير: ${formatters.dateTime.format(new Date(context.lastReminderAt))}`}
          </Text>
        ) : null}
      </Card>

      {/* The chain itself. */}
      <View style={{ gap: spacing.sm }}>
        <SectionHeader title="خطوات التنفيذ" />
        <Card>
          {execution.steps.map((step, index) => (
            <TimelineRow
              key={step.id}
              step={step}
              isLast={index === execution.steps.length - 1}
              driverName={order.driver_name}
              specialistName={order.specialist_name}
            />
          ))}
        </Card>
      </View>

      {/* Who to nudge. */}
      <View style={{ gap: spacing.sm }}>
        <SectionHeader title="تذكير الفريق" />
        {reminder.isError ? <InlineAlert message={reminder.error.message} /> : null}
        {context && !context.whatsappConfigured ? (
          <InlineAlert
            tone="warning"
            message="واتساب غير متصل حاليًا — التذكير سيصل عبر إشعار التطبيق فقط."
          />
        ) : null}
        <RecipientCard
          role="driver"
          name={order.driver_name}
          phone={order.driver_phone}
          recipient={recipientOf("driver")}
          execution={execution}
          onRemind={() => openComposer("driver")}
        />
        <RecipientCard
          role="specialist"
          name={order.specialist_name}
          phone={null}
          recipient={recipientOf("specialist")}
          execution={execution}
          onRemind={() => openComposer("specialist")}
        />
      </View>
    </ScrollView>
  );
}
