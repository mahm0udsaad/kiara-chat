import { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
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
      <Card style={{ gap: spacing.md }}>
        <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}>
          <IconSymbol name={sent ? "checkmark.circle" : "paperplane.fill"} size={20} color={sent ? colors.success : colors.brand} />
          <View style={{ flex: 1, gap: spacing.xs }}>
            <Text selectable style={{ ...type.headline, color: colors.text, ...rtlText }}>تذكير العميلة</Text>
            <Text selectable style={{ ...type.footnote, color: colors.textSecondary, ...rtlText }}>
              {sent && state?.sentAt
                ? `أُرسل ${formatters.dateTime.format(new Date(state.sentAt))}`
                : "أخبري العميلة أن الأخصائية في الطريق واطلبي تجهيز غرفة مناسبة."}
            </Text>
          </View>
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
        <PrimaryButton
          testID="order-remind-client"
          label={label}
          icon={sent ? "checkmark.circle" : "paperplane.fill"}
          variant={sent ? "tinted" : "filled"}
          disabled={!editable}
          loading={reminder.isLoading}
          loadingLabel="جارٍ تحميل التذكير…"
          onPress={openConfirmation}
        />
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
