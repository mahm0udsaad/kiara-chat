import { useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as Crypto from "expo-crypto";

import { PrimaryButton } from "@/components/primary-button";
import { InlineAlert } from "@/components/screen-state";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { hitSize, radius, rtlText, spacing, type } from "@/constants/theme";
import { commitFeedback, tapFeedback } from "@/lib/haptics";
import { useClaimedConversationForPhone, useReply } from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";

type Destination = "same" | "other";

export function MessageResendSheet({
  open,
  conversationId,
  originalBody,
  onClose,
}: {
  open: boolean;
  conversationId: string;
  originalBody: string;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const reply = useReply(conversationId);
  const target = useClaimedConversationForPhone();
  const [destination, setDestination] = useState<Destination>("same");
  const [body, setBody] = useState(originalBody);
  const [phone, setPhone] = useState("");
  const attempt = useRef<{ text: string; idempotencyKey: string } | null>(null);

  const busy = reply.isPending || target.isPending;
  const error = reply.error?.message ?? target.error?.message ?? null;

  function resendHere() {
    const text = body.trim();
    if (!text || busy) return;
    const current =
      attempt.current?.text === text
        ? attempt.current
        : { text, idempotencyKey: Crypto.randomUUID() };
    attempt.current = current;
    commitFeedback();
    reply.mutate(current, {
      onSuccess: () => {
        attempt.current = null;
        onClose();
      },
    });
  }

  function reviewForOtherCustomer() {
    const text = body.trim();
    const targetPhone = phone.trim();
    if (!text || !targetPhone || busy) return;
    tapFeedback();
    target.mutate(
      { phone: targetPhone },
      {
        onSuccess: ({ conversationId: nextId }) => {
          onClose();
          router.push({
            pathname: "/conversation/[id]",
            params: { id: nextId, draft: text },
          });
        },
      },
    );
  }

  return (
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, padding: spacing.lg, paddingBottom: spacing.lg + insets.bottom, gap: spacing.lg, backgroundColor: colors.background }}>
        <View style={{ flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between" }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ ...type.title3, color: colors.text, ...rtlText }}>إعادة إرسال الرسالة</Text>
            <Text style={{ ...type.footnote, color: colors.textSecondary, ...rtlText }}>راجعي النص النهائي وعدّليه قبل الإرسال.</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="إغلاق" disabled={busy} onPress={onClose} style={({ pressed }) => ({ width: hitSize.min, height: hitSize.min, alignItems: "center", justifyContent: "center", borderRadius: radius.full, backgroundColor: colors.surfaceSunken, opacity: pressed ? 0.6 : 1 })}>
            <IconSymbol name="xmark" color={colors.textSecondary} size={18} />
          </Pressable>
        </View>

        <View accessibilityRole="radiogroup" style={{ flexDirection: "row-reverse", gap: spacing.sm }}>
          {([
            { value: "same", label: "نفس العميلة" },
            { value: "other", label: "عميلة أخرى" },
          ] as const).map((option) => (
            <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ selected: destination === option.value }} onPress={() => { tapFeedback(); setDestination(option.value); }} style={({ pressed }) => ({ flex: 1, minHeight: hitSize.comfortable, alignItems: "center", justifyContent: "center", borderRadius: radius.md, borderWidth: destination === option.value ? 1.5 : 1, borderColor: destination === option.value ? colors.brand : colors.border, backgroundColor: destination === option.value ? colors.brandSoft : colors.surface, opacity: pressed ? 0.7 : 1 })}>
              <Text style={{ ...type.subheadStrong, color: destination === option.value ? colors.onBrandSoft : colors.textSecondary, ...rtlText }}>{option.label}</Text>
            </Pressable>
          ))}
        </View>

        {destination === "other" ? (
          <View style={{ gap: spacing.xs }}>
            <Text style={{ ...type.subheadStrong, color: colors.text, ...rtlText }}>رقم العميلة</Text>
            <TextInput accessibilityLabel="رقم العميلة الأخرى" keyboardType="phone-pad" value={phone} onChangeText={setPhone} placeholder="مثال: +9665…" placeholderTextColor={colors.textTertiary} style={{ minHeight: hitSize.comfortable, paddingHorizontal: spacing.lg, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, backgroundColor: colors.surface, color: colors.text, ...type.body, writingDirection: "ltr", textAlign: "left" }} />
          </View>
        ) : null}

        <View style={{ flex: 1, gap: spacing.xs }}>
          <Text style={{ ...type.subheadStrong, color: colors.text, ...rtlText }}>النص النهائي</Text>
          <TextInput accessibilityLabel="النص النهائي للرسالة" multiline value={body} onChangeText={setBody} maxLength={4096} textAlignVertical="top" style={{ flex: 1, minHeight: 180, padding: spacing.lg, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.lg, backgroundColor: colors.surface, color: colors.text, ...type.body, ...rtlText }} />
        </View>

        {error ? <InlineAlert message={error} /> : null}
        {destination === "same" ? (
          <PrimaryButton label="إرسال للعميلة نفسها" icon="paperplane.fill" loading={reply.isPending} disabled={!body.trim()} onPress={resendHere} />
        ) : (
          <PrimaryButton label="فتح المحادثة ومراجعة الإرسال" icon="chevron.left" loading={target.isPending} disabled={!body.trim() || !phone.trim()} onPress={reviewForOtherCustomer} />
        )}
        {busy ? <ActivityIndicator color={colors.brand} /> : null}
      </View>
    </Modal>
  );
}
