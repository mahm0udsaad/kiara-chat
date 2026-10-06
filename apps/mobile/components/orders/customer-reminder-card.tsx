import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PrimaryButton } from "@/components/primary-button";
import { InlineAlert } from "@/components/screen-state";
import { Card } from "@/components/ui/card";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { radius, rtlText, spacing, type } from "@/constants/theme";
import { formatters } from "@/lib/format";
import { useOrderCustomerReminder, useSendOrderCustomerReminder } from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";

export function CustomerReminderCard({
  orderId,
  canSend,
}: {
  orderId: string;
  canSend: boolean;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const reminder = useOrderCustomerReminder(orderId);
  const send = useSendOrderCustomerReminder(orderId);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const state = reminder.data?.reminder;
  const status = state?.status;
  const sent = status === "sent";
  const pending = status === "sending" || status === "uncertain";
  const editable = Boolean(state && canSend && !sent && !pending);

  const openConfirmation = () => {
    if (!editable) return;
    setDraft(state!.body);
    send.reset();
    setOpen(true);
  };

  const label = sent
    ? "تم إرسال التذكير"
    : status === "sending"
      ? "جارٍ إرسال التذكير"
      : status === "uncertain"
        ? "تحققي من حالة التذكير"
        : !canSend
          ? "أرسلي الطلب أولًا"
          : "تذكير العميلة";

  return (
    <>
      {/* One row: the reminder is one tap among many on this screen, so it
          must not push the order itself below the fold. */}
      <Card style={{ gap: spacing.sm }}>
        <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.md }}>
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: radius.full,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: sent ? colors.successSoft : colors.brandSoft,
            }}
          >
            <IconSymbol
              name={sent ? "checkmark.circle" : "paperplane.fill"}
              size={17}
              color={sent ? colors.onSuccessSoft : colors.onBrandSoft}
            />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ ...type.subheadStrong, color: colors.text, ...rtlText }}>تذكير العميلة</Text>
            <Text numberOfLines={1} style={{ ...type.caption, color: colors.textSecondary, ...rtlText }}>
              {sent && state?.sentAt
                ? `أُرسل ${formatters.dateTime.format(new Date(state.sentAt))}`
                : status === "sending"
                  ? "جارٍ إرسال التذكير…"
                  : !canSend
                    ? "يُتاح بعد إرسال الطلب للفريق"
                    : "الأخصائية في الطريق وتجهيز غرفة مناسبة"}
            </Text>
          </View>
          {sent ? null : (
            <Pressable
              testID="order-remind-client"
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ disabled: !editable, busy: reminder.isLoading }}
              disabled={!editable}
              onPress={openConfirmation}
              style={({ pressed }) => ({
                minHeight: 36,
                minWidth: 72,
                flexDirection: "row-reverse",
                alignItems: "center",
                justifyContent: "center",
                gap: spacing.xs,
                paddingHorizontal: spacing.md,
                borderRadius: radius.full,
                backgroundColor: colors.brand,
                opacity: !editable ? 0.4 : pressed ? 0.8 : 1,
              })}
            >
              {reminder.isLoading ? (
                <ActivityIndicator size="small" color={colors.onBrand} />
              ) : (
                <Text style={{ ...type.caption, fontWeight: "600", color: colors.onBrand }}>
                  {status === "uncertain" ? "تحققي" : "إرسال"}
                </Text>
              )}
            </Pressable>
          )}
        </View>

        {reminder.isError ? (
          <>
            <InlineAlert message={reminder.error.message} />
            <PrimaryButton label="إعادة تحميل حالة التذكير" variant="outline" onPress={() => void reminder.refetch()} />
          </>
        ) : null}
        {status === "uncertain" ? (
          <InlineAlert message="لا يمكن تأكيد نتيجة الإرسال. تحققي من المحادثة قبل إعادة المحاولة." />
        ) : null}
      </Card>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => !send.isPending && setOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: colors.overlay }}>
            <Pressable style={{ flex: 1 }} onPress={() => !send.isPending && setOpen(false)} />
            <View
              style={{
                maxHeight: "88%",
                padding: spacing.lg,
                paddingBottom: spacing.lg + insets.bottom,
                gap: spacing.md,
                borderTopLeftRadius: radius["2xl"],
                borderTopRightRadius: radius["2xl"],
                backgroundColor: colors.surface,
              }}
            >
              <Text style={{ ...type.title3, color: colors.text, ...rtlText }}>تأكيد تذكير العميلة</Text>
              <Text style={{ ...type.footnote, color: colors.textSecondary, ...rtlText }}>
                هذا النص الذي سيصل للعميلة. يمكنكِ تعديله قبل الإرسال؛ النص المعدّل يتطلب محادثة مسندة لكِ ورسالة من العميلة خلال آخر ٢٤ ساعة.
              </Text>
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.sm }}>
                <TextInput
                  testID="order-reminder-message"
                  accessibilityLabel="نص التذكير الذي سيصل للعميلة"
                  value={draft}
                  onChangeText={setDraft}
                  multiline
                  maxLength={4096}
                  textAlign="right"
                  style={{
                    minHeight: 190,
                    padding: spacing.md,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: radius.md,
                    color: colors.text,
                    backgroundColor: colors.surfaceSunken,
                    ...type.body,
                    ...rtlText,
                    textAlignVertical: "top",
                  }}
                />
                {draft !== state?.body ? (
                  <Pressable accessibilityRole="button" onPress={() => setDraft(state?.body ?? "")}>
                    <Text style={{ ...type.footnote, color: colors.brand, ...rtlText }}>استعادة النص المعتمد</Text>
                  </Pressable>
                ) : null}
              </ScrollView>
              {send.isError ? <InlineAlert message={send.error.message} /> : null}
              <PrimaryButton
                testID="order-reminder-confirm-send"
                label="إرسال التذكير للعميلة"
                loading={send.isPending}
                loadingLabel="جارٍ إرسال التذكير…"
                disabled={!draft.trim() || !canSend || sent || pending}
                onPress={() => send.mutate(draft, { onSuccess: () => setOpen(false) })}
              />
              <PrimaryButton label="إلغاء" variant="plain" disabled={send.isPending} onPress={() => setOpen(false)} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}
