import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { InlineAlert } from "@/components/screen-state";
import { PrimaryButton } from "@/components/primary-button";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { hitSize, radius, rtlText, spacing, type } from "@/constants/theme";
import { successFeedback, tapFeedback } from "@/lib/haptics";
import {
  useConversation,
  useMessageTemplates,
  useSendTemplate,
} from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";
import type { MessageTemplate } from "@/types/api";

/**
 * القوالب — approved WhatsApp templates.
 *
 * This is not another canned-reply list. A saved reply is text the employee
 * could have typed herself; a template is the *only* thing WhatsApp will
 * deliver to a customer who has not written in the last 24 hours, including
 * one who has never written at all. So picking one sends immediately rather
 * than dropping text into the draft — there is no free-form message to attach
 * it to, which is the entire reason it exists.
 */
export function TemplatesSheet({
  open,
  conversationId,
  onClose,
  onSent,
}: {
  open: boolean;
  conversationId: string;
  onClose: () => void;
  onSent?: () => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const templates = useMessageTemplates(open);
  const send = useSendTemplate(conversationId);
  // The thread already knows who she is; asking the employee to retype it
  // would be the app forgetting something it is looking at.
  const conversation = useConversation(conversationId);
  const customerName =
    conversation.data?.conversation?.customer_name ?? null;

  const [selected, setSelected] = useState<MessageTemplate | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  /**
   * Closing clears the form. Reopening must never resume a half-filled
   * template aimed at whoever the previous customer was — this sheet sends to
   * a real person the moment the button is pressed.
   */
  const close = () => {
    setSelected(null);
    setValues({});
    setError(null);
    onClose();
  };

  const pick = (template: MessageTemplate) => {
    tapFeedback();
    setError(null);
    setSelected(template);
    // Prefill what the thread already knows, so the common case is one tap.
    const seeded: Record<string, string> = {};
    for (const variable of template.variables) {
      seeded[variable.key] =
        variable.prefill === "customer_name"
          ? (customerName ?? "").trim() || "عميلتنا العزيزة"
          : "";
    }
    setValues(seeded);
  };

  /** The message exactly as the customer will read it. */
  const preview = useMemo(() => {
    if (!selected) return "";
    return selected.body.replace(/\{\{(\d+)\}\}/g, (whole, index: string) => {
      const value = values[index];
      return value && value.trim() ? value.trim() : whole;
    });
  }, [selected, values]);

  const missing = useMemo(() => {
    if (!selected) return [] as string[];
    return selected.variables
      .filter((v) => !(values[v.key] ?? "").trim())
      .map((v) => v.label);
  }, [selected, values]);

  const submit = () => {
    if (!selected || missing.length) return;
    setError(null);
    send.mutate(
      { key: selected.key, variables: values },
      {
        onSuccess: () => {
          successFeedback();
          onSent?.();
          close();
        },
        onError: (e: Error) => setError(e.message),
      },
    );
  };

  return (
    <Modal
      visible={open}
      transparent
      animationType="slide"
      onRequestClose={close}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="إغلاق القوالب"
          onPress={close}
          style={{
            flex: 1,
            justifyContent: "flex-end",
            backgroundColor: colors.overlay,
          }}
        >
          <Pressable
            onPress={() => {}}
            style={{
              maxHeight: "88%",
              padding: spacing.lg,
              paddingBottom: spacing.lg + insets.bottom,
              gap: spacing.md,
              borderTopLeftRadius: radius["2xl"],
              borderTopRightRadius: radius["2xl"],
              borderCurve: "continuous",
              backgroundColor: colors.surface,
            }}
          >
            <View
              style={{
                flexDirection: "row-reverse",
                alignItems: "center",
                gap: spacing.sm,
              }}
            >
              <IconSymbol name="doc.text" color={colors.text} size={20} />
              <Text style={{ ...type.title3, color: colors.text, ...rtlText }}>
                {selected ? selected.label : "القوالب"}
              </Text>
            </View>

            {/* Why this screen exists, said once. Employees hit the 24-hour
                rule without ever being told there is one. */}
            <Text
              style={{
                ...type.caption,
                color: colors.textSecondary,
                ...rtlText,
              }}
            >
              {selected
                ? selected.description
                : "لمراسلة عميلة لم تراسلكِ خلال ٢٤ ساعة. الرسائل العادية لا تصل بعد هذه المدة."}
            </Text>

            {error ? <InlineAlert message={error} /> : null}

            {templates.isLoading ? (
              <View style={{ paddingVertical: spacing.xl, alignItems: "center" }}>
                <ActivityIndicator color={colors.textSecondary} />
              </View>
            ) : !selected ? (
              <ScrollView
                keyboardShouldPersistTaps="handled"
                style={{ maxHeight: 380 }}
              >
                <View style={{ gap: spacing.sm }}>
                  {(templates.data?.templates ?? []).map((template) => (
                    <Pressable
                      key={template.key}
                      accessibilityRole="button"
                      onPress={() => pick(template)}
                      style={({ pressed }) => ({
                        gap: spacing.xs,
                        padding: spacing.lg,
                        borderRadius: radius.lg,
                        borderCurve: "continuous",
                        borderWidth: 1,
                        borderColor: colors.border,
                        backgroundColor: pressed
                          ? colors.surfaceSunken
                          : colors.surface,
                      })}
                    >
                      <Text
                        style={{ ...type.bodyStrong, color: colors.text, ...rtlText }}
                      >
                        {template.label}
                      </Text>
                      <Text
                        numberOfLines={2}
                        style={{
                          ...type.caption,
                          color: colors.textSecondary,
                          ...rtlText,
                        }}
                      >
                        {template.body}
                      </Text>
                    </Pressable>
                  ))}
                  {!templates.data?.templates.length ? (
                    <Text
                      style={{
                        ...type.caption,
                        color: colors.textTertiary,
                        ...rtlText,
                        paddingVertical: spacing.lg,
                      }}
                    >
                      لا توجد قوالب معتمدة بعد.
                    </Text>
                  ) : null}
                </View>
              </ScrollView>
            ) : (
              <ScrollView keyboardShouldPersistTaps="handled">
                <View style={{ gap: spacing.md }}>
                  {selected.variables.map((variable) => (
                    <View key={variable.key} style={{ gap: spacing.xs }}>
                      <Text
                        style={{
                          ...type.caption,
                          color: colors.textSecondary,
                          ...rtlText,
                        }}
                      >
                        {variable.label}
                      </Text>
                      <TextInput
                        accessibilityLabel={variable.label}
                        value={values[variable.key] ?? ""}
                        onChangeText={(text) =>
                          setValues((current) => ({
                            ...current,
                            [variable.key]: text,
                          }))
                        }
                        maxLength={variable.maxLength ?? undefined}
                        style={{
                          minHeight: hitSize.comfortable,
                          paddingHorizontal: spacing.lg,
                          paddingVertical: spacing.md,
                          borderWidth: 1,
                          borderColor: colors.border,
                          borderRadius: radius.lg,
                          borderCurve: "continuous",
                          backgroundColor: colors.surfaceSunken,
                          ...type.body,
                          color: colors.text,
                          ...rtlText,
                        }}
                      />
                    </View>
                  ))}

                  {/* Exactly what she is about to send — a template is not
                      editable afterwards and goes out to a real customer. */}
                  <View style={{ gap: spacing.xs }}>
                    <Text
                      style={{
                        ...type.caption,
                        color: colors.textSecondary,
                        ...rtlText,
                      }}
                    >
                      معاينة
                    </Text>
                    <Text
                      style={{
                        ...type.footnote,
                        color: colors.textTertiary,
                        ...rtlText,
                      }}
                    >
                      نص القالب معتمد وثابت من واتساب. يمكنك تعديل البيانات أعلاه قبل الإرسال.
                    </Text>
                    <View
                      style={{
                        padding: spacing.lg,
                        borderRadius: radius.lg,
                        borderCurve: "continuous",
                        backgroundColor: colors.surfaceSunken,
                        gap: spacing.sm,
                      }}
                    >
                      <Text style={{ ...type.body, color: colors.text, ...rtlText }}>
                        {preview}
                      </Text>
                      {selected.buttons.length ? (
                        <View style={{ gap: spacing.xs }}>
                          {selected.buttons.map((button) => (
                            <View
                              key={button}
                              style={{
                                paddingVertical: spacing.sm,
                                borderRadius: radius.md,
                                borderCurve: "continuous",
                                borderWidth: 1,
                                borderColor: colors.border,
                                alignItems: "center",
                              }}
                            >
                              <Text
                                style={{ ...type.caption, color: colors.brand }}
                              >
                                {button}
                              </Text>
                            </View>
                          ))}
                        </View>
                      ) : null}
                    </View>
                  </View>

                  <PrimaryButton
                    label={send.isPending ? "جارٍ الإرسال…" : "إرسال"}
                    onPress={submit}
                    disabled={send.isPending || missing.length > 0}
                  />
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setSelected(null)}
                    style={{ alignItems: "center", paddingVertical: spacing.sm }}
                  >
                    <Text style={{ ...type.caption, color: colors.textSecondary }}>
                      اختيار قالب آخر
                    </Text>
                  </Pressable>
                </View>
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
