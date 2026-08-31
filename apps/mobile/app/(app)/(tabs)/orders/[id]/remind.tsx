import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ActionBar, PrimaryButton } from "@/components/primary-button";
import { ErrorState, InlineAlert, LoadingScreen } from "@/components/screen-state";
import { Card } from "@/components/ui/card";
import { TextAreaField } from "@/components/ui/field";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { Segmented, type SegmentOption } from "@/components/ui/segmented";
import { hitSize, radius, rtlText, spacing, type } from "@/constants/theme";
import { ROLE_LABEL } from "@/lib/execution";
import { formatters, relativeDayLabel } from "@/lib/format";
import { errorFeedback, successFeedback, tapFeedback } from "@/lib/haptics";
import { useOrderReminder, useSendOrderReminder } from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";
import type {
  FieldSessionRole,
  OrderReminderChannel,
  OrderReminderRecipient,
} from "@/types/api";

/**
 * Writing and sending one reminder.
 *
 * The server suggests the opening text — it knows which step is outstanding
 * and whose it is — and everything after that is the employee's. What she sees
 * in the box is exactly what is sent, on exactly the channels she left on,
 * which is the same contract the dispatch screen makes about its two messages.
 */

const MAX_LENGTH = 1_500;

const roleOptions: SegmentOption<FieldSessionRole>[] = [
  { value: "driver", label: "السائق" },
  { value: "specialist", label: "الأخصائية" },
];

/** Extra lines an employee reaches for often enough to be worth one tap. */
const additions = [
  "الرجاء الرد بالتأكيد فور استلام الرسالة.",
  "العميلة تنتظر منذ فترة، نرجو الإسراع.",
  "في حال وجود تأخير، أبلغينا بالوقت المتوقع.",
  "تم تعديل الموعد، يرجى مراجعة التفاصيل في التطبيق.",
];

function ChannelToggle({
  icon,
  label,
  detail,
  selected,
  disabled,
  onPress,
}: {
  icon: "bell" | "message";
  label: string;
  detail: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={`${label}. ${detail}`}
      disabled={disabled}
      onPress={() => {
        tapFeedback();
        onPress();
      }}
      style={({ pressed }) => ({
        flex: 1,
        gap: spacing.xs,
        padding: spacing.md,
        minHeight: hitSize.comfortable,
        borderRadius: radius.lg,
        borderCurve: "continuous",
        borderWidth: selected ? 1.5 : 1,
        borderColor: selected ? colors.brand : colors.border,
        backgroundColor: selected ? colors.brandSoft : colors.surface,
        opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
      })}
    >
      <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}>
        <IconSymbol
          name={selected ? "checkmark.circle" : icon}
          color={selected ? colors.brand : colors.textTertiary}
          size={17}
        />
        <Text
          style={{
            flex: 1,
            ...type.calloutStrong,
            color: selected ? colors.onBrandSoft : colors.text,
            ...rtlText,
          }}
        >
          {label}
        </Text>
      </View>
      <Text style={{ ...type.caption, color: colors.textSecondary, ...rtlText }}>
        {detail}
      </Text>
    </Pressable>
  );
}

function RemindForm({ id, initialRole }: { id: string; initialRole: FieldSessionRole }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const context = useOrderReminder(id);
  const send = useSendOrderReminder(id);

  const [role, setRole] = useState<FieldSessionRole>(initialRole);
  const [message, setMessage] = useState("");
  const [channels, setChannels] = useState<OrderReminderChannel[]>(["push"]);
  const [validation, setValidation] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  // Which recipient's suggested text is currently in the box. Switching
  // recipients reloads the suggestion; typing after that is never overwritten,
  // including by the 20s background refetch.
  const loadedFor = useRef<FieldSessionRole | null>(null);

  const recipients = context.data?.reminder.recipients;
  const recipient: OrderReminderRecipient | undefined = useMemo(
    () => recipients?.find((person) => person.role === role),
    [recipients, role],
  );

  useEffect(() => {
    if (!recipient || loadedFor.current === role) return;
    loadedFor.current = role;
    setMessage(recipient.message);
    setResult(null);
    setValidation(null);
    // Every channel that can carry it, not the best single one.
    //
    // A reminder exists because someone has not acted yet, and the two
    // channels fail in different ways: a push dies silently on a phone with
    // notifications off, and WhatsApp goes unread on a driver mid-trip.
    // Defaulting to one of them made the salon send the same reminder twice
    // by hand. Both stay switchable.
    setChannels(
      (["push", "whatsapp"] as const).filter((channel) =>
        channel === "push" ? recipient.canPush : recipient.canWhatsapp,
      ),
    );
  }, [recipient, role]);

  if (context.isLoading) return <LoadingScreen label="جارٍ تجهيز التذكير…" />;
  if (context.isError || !context.data) {
    return (
      <ErrorState
        title="تعذر تجهيز التذكير"
        message={context.error?.message ?? "الطلب غير موجود"}
        onRetry={() => void context.refetch()}
      />
    );
  }

  const reminder = context.data.reminder;
  const toggle = (channel: OrderReminderChannel) =>
    setChannels((current) =>
      current.includes(channel)
        ? current.filter((item) => item !== channel)
        : [...current, channel],
    );

  const submit = () => {
    if (!recipient?.rosterId) {
      return setValidation(
        `لم يتم تحديد ${ROLE_LABEL[role]} لهذا الطلب. عدّلي الطلب أولاً.`,
      );
    }
    if (!message.trim()) return setValidation("اكتبي نص التذكير قبل الإرسال.");
    if (!channels.length) return setValidation("اختاري وسيلة إرسال واحدة على الأقل.");
    setValidation(null);
    setResult(null);
    send.mutate(
      { role, message: message.trim(), channels },
      {
        // A 200 means the server processed the request, not that anything
        // arrived. Each channel reports for itself, so a WhatsApp engine that
        // is down never reads as a delivered reminder.
        onSuccess: ({ delivery }) => {
          if (!delivery.delivered) {
            errorFeedback();
            setValidation(
              "لم يصل التذكير عبر أي وسيلة. راجعي حالة الاتصال ثم أعيدي المحاولة.",
            );
            return;
          }
          const parts: string[] = [];
          if (delivery.push) {
            parts.push(
              delivery.push.accepted > 0
                ? "تم إرسال إشعار التطبيق"
                : "تعذّر إرسال إشعار التطبيق",
            );
          }
          if (delivery.whatsapp) {
            parts.push(
              delivery.whatsapp.sent
                ? "تم إرسال رسالة واتساب"
                : "تعذّر إرسال رسالة واتساب",
            );
          }
          successFeedback();
          // Partial delivery stays on screen: she chose two channels and only
          // one landed, and that is hers to act on. A clean send closes.
          const partial = parts.some((part) => part.startsWith("تعذّر"));
          if (partial) {
            setResult(parts.join(" · "));
            return;
          }
          router.back();
        },
      },
    );
  };

  const pendingHere = reminder.pendingRole === role;

  return (
    <KeyboardAvoidingView
      behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{
          padding: spacing.lg,
          gap: spacing.xl,
          paddingBottom: spacing["3xl"],
        }}
      >
        {/* The visit the reminder is about, so it is never sent blind. */}
        <Card>
          <Text selectable style={{ ...type.headline, color: colors.text, ...rtlText }}>
            {reminder.customerName || reminder.customerPhone}
          </Text>
          <Text
            style={{
              ...type.footnote,
              color: colors.textSecondary,
              fontVariant: ["tabular-nums"],
              ...rtlText,
            }}
          >
            {`${relativeDayLabel(reminder.arrivalAt)} · ${formatters.time.format(
              new Date(reminder.arrivalAt),
            )}`}
          </Text>
          {reminder.pendingRole && reminder.pendingLabel ? (
            <Text style={{ ...type.footnote, color: colors.textSecondary, ...rtlText }}>
              {`الخطوة المعلّقة: ${reminder.pendingLabel} — على ${
                ROLE_LABEL[reminder.pendingRole]
              }`}
            </Text>
          ) : (
            <Text style={{ ...type.footnote, color: colors.textSecondary, ...rtlText }}>
              اكتملت خطوات هذا الطلب.
            </Text>
          )}
          {reminder.lastReminderAt ? (
            <Text style={{ ...type.caption, color: colors.textTertiary, ...rtlText }}>
              {`آخر تذكير: ${formatters.dateTime.format(new Date(reminder.lastReminderAt))}`}
            </Text>
          ) : null}
        </Card>

        <View style={{ gap: spacing.sm }}>
          <Text style={{ ...type.subheadStrong, color: colors.text, ...rtlText }}>
            إلى مَن يُرسل التذكير؟
          </Text>
          <Segmented
            accessibilityLabel="اختيار مستلم التذكير"
            options={roleOptions}
            value={role}
            onChange={setRole}
          />
          <Text style={{ ...type.caption, color: colors.textTertiary, ...rtlText }}>
            {recipient?.name
              ? pendingHere
                ? `${recipient.name} — الخطوة الحالية عليه`
                : `${recipient.name} — لا توجد خطوة معلّقة عليه حاليًا`
              : `لم يتم تحديد ${ROLE_LABEL[role]} لهذا الطلب.`}
          </Text>
        </View>

        <View style={{ gap: spacing.sm }}>
          <Text style={{ ...type.subheadStrong, color: colors.text, ...rtlText }}>
            وسيلة الإرسال
          </Text>
          <View style={{ flexDirection: "row-reverse", gap: spacing.md }}>
            <ChannelToggle
              icon="bell"
              label="إشعار التطبيق"
              detail={
                recipient?.canPush
                  ? "يصل مباشرة على جهاز الموظف"
                  : "لا يوجد جهاز مسجّل"
              }
              selected={channels.includes("push")}
              disabled={!recipient?.canPush}
              onPress={() => toggle("push")}
            />
            <ChannelToggle
              icon="message"
              label="رسالة واتساب"
              detail={
                recipient?.canWhatsapp
                  ? "تُرسل من رقم كيارا"
                  : reminder.whatsappConfigured
                    ? "لا يوجد رقم مسجّل"
                    : "واتساب غير متصل"
              }
              selected={channels.includes("whatsapp")}
              disabled={!recipient?.canWhatsapp}
              onPress={() => toggle("whatsapp")}
            />
          </View>
          {!recipient?.canPush && !recipient?.canWhatsapp && recipient?.rosterId ? (
            <InlineAlert
              tone="warning"
              message={`لا توجد وسيلة متاحة للوصول إلى ${
                recipient.name || ROLE_LABEL[role]
              }. أضيفي رقمه في الفريق أو اطلبي منه تسجيل الدخول للتطبيق.`}
            />
          ) : null}
        </View>

        <View style={{ gap: spacing.sm }}>
          <TextAreaField
            label="نص التذكير"
            value={message}
            onChangeText={setMessage}
            maxLength={MAX_LENGTH}
            minHeight={220}
            placeholder="اكتبي نص التذكير…"
          />
          <Text style={{ ...type.caption, color: colors.textTertiary, ...rtlText }}>
            سيصل النص الظاهر أعلاه حرفيًا على الوسائل المحددة.
          </Text>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: spacing.sm, paddingVertical: spacing.xs }}
          >
            {additions.map((addition) => (
              <Pressable
                key={addition}
                accessibilityRole="button"
                accessibilityLabel={`إضافة: ${addition}`}
                onPress={() => {
                  tapFeedback();
                  setMessage((current) => {
                    const next = current.trim()
                      ? `${current.trim()}\n${addition}`
                      : addition;
                    return next.slice(0, MAX_LENGTH);
                  });
                }}
                style={({ pressed }) => ({
                  minHeight: hitSize.min,
                  justifyContent: "center",
                  paddingHorizontal: spacing.md + 2,
                  borderRadius: radius.full,
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: pressed ? colors.surfaceSunken : colors.surface,
                })}
              >
                <Text style={{ ...type.footnote, color: colors.textSecondary, ...rtlText }}>
                  {addition}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="استعادة النص المقترح"
            onPress={() => {
              if (!recipient) return;
              tapFeedback();
              setMessage(recipient.message);
            }}
            style={({ pressed }) => ({
              minHeight: hitSize.min,
              flexDirection: "row-reverse",
              alignItems: "center",
              gap: spacing.sm,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <IconSymbol name="arrow.clockwise" color={colors.brand} size={15} />
            <Text style={{ ...type.footnote, color: colors.brand, ...rtlText }}>
              استعادة النص المقترح
            </Text>
          </Pressable>
        </View>

        {validation ? <InlineAlert message={validation} /> : null}
        {send.error ? <InlineAlert message={send.error.message} /> : null}
        {result ? <InlineAlert tone="warning" message={result} /> : null}
      </ScrollView>

      <ActionBar bottomInset={insets.bottom}>
        <PrimaryButton
          label="إرسال التذكير"
          icon="paperplane.fill"
          loading={send.isPending}
          loadingLabel="جاري الإرسال…"
          onPress={submit}
          testID="reminder-send"
        />
        <PrimaryButton
          label="إلغاء"
          icon="chevron.right"
          variant="plain"
          disabled={send.isPending}
          onPress={() => router.back()}
        />
      </ActionBar>
    </KeyboardAvoidingView>
  );
}

export default function RemindOrderScreen() {
  const params = useLocalSearchParams<{
    id: string | string[];
    role?: string | string[];
  }>();
  const id = useMemo(
    () => (Array.isArray(params.id) ? (params.id[0] ?? "") : (params.id ?? "")),
    [params.id],
  );
  const role = useMemo<FieldSessionRole>(() => {
    const raw = Array.isArray(params.role) ? params.role[0] : params.role;
    return raw === "specialist" ? "specialist" : "driver";
  }, [params.role]);

  return <RemindForm id={id} initialRole={role} />;
}
