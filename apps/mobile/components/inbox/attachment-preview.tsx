import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { InlineAlert } from "@/components/screen-state";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { hitSize, radius, rtlText, spacing, type } from "@/constants/theme";
import { useTheme } from "@/providers/theme-provider";

/** A file chosen but not yet sent. Nothing uploads until send is pressed. */
export type PendingAttachment = {
  id: string;
  uri: string;
  name: string;
  mimeType: string;
  isImage: boolean;
  caption: string;
  /** Captured microphone audio should remain a WhatsApp push-to-talk note. */
  voiceNote?: boolean;
};

/**
 * WhatsApp-style review step: the picked files are shown full-bleed with a
 * caption box, and only then sent — one request each, in order, so a caption
 * stays attached to its own file.
 */
export function AttachmentPreview({
  attachments,
  activeIndex,
  sending,
  error,
  onSetActive,
  onChangeCaption,
  onRemove,
  onClose,
  onSend,
}: {
  attachments: PendingAttachment[];
  activeIndex: number;
  sending: boolean;
  error: string | null;
  onSetActive: (index: number) => void;
  onChangeCaption: (id: string, caption: string) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
  onSend: () => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const active = attachments[activeIndex];

  return (
    <Modal
      visible={attachments.length > 0}
      onRequestClose={sending ? () => {} : onClose}
      animationType="slide"
      presentationStyle="pageSheet"
    >
      <KeyboardAvoidingView
        // Inside a Modal, Android's windowSoftInputMode=adjustResize can't reach
        // this separate window, so — unlike the full-screen forms — the keyboard
        // has to be avoided in JS here.
        behavior={process.env.EXPO_OS === "ios" ? "padding" : "height"}
        style={{ flex: 1, backgroundColor: colors.background }}
      >
        <View
          style={{
            flexDirection: "row-reverse",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: spacing.lg,
            paddingTop: spacing.lg,
            paddingBottom: spacing.md,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
            backgroundColor: colors.surface,
          }}
        >
          <Text style={{ ...type.title3, color: colors.text, ...rtlText }}>
            {attachments.length > 1 ? `${attachments.length} ملفات` : "إرسال ملف"}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="إلغاء"
            disabled={sending}
            onPress={onClose}
            style={({ pressed }) => ({
              width: hitSize.min,
              height: hitSize.min,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: radius.full,
              backgroundColor: colors.surfaceSunken,
              opacity: sending ? 0.4 : pressed ? 0.6 : 1,
            })}
          >
            <IconSymbol name="xmark" color={colors.textSecondary} size={18} />
          </Pressable>
        </View>

        <View style={{ flex: 1, padding: spacing.lg, gap: spacing.md }}>
          {error ? <InlineAlert message={error} /> : null}

          <View
            style={{
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: radius.xl,
              borderCurve: "continuous",
              overflow: "hidden",
              backgroundColor: colors.surfaceSunken,
            }}
          >
            {active?.isImage ? (
              <Image
                source={active.uri}
                contentFit="contain"
                transition={120}
                style={{ width: "100%", height: "100%" }}
              />
            ) : (
              <View style={{ alignItems: "center", gap: spacing.sm, padding: spacing.xl }}>
                <IconSymbol name="doc.text" color={colors.textTertiary} size={44} />
                <Text
                  numberOfLines={2}
                  style={{ ...type.callout, color: colors.textSecondary, textAlign: "center" }}
                >
                  {active?.name ?? "ملف"}
                </Text>
              </View>
            )}
          </View>

          {attachments.length > 1 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ flexDirection: "row-reverse", gap: spacing.sm }}
            >
              {attachments.map((attachment, index) => (
                <Pressable
                  key={attachment.id}
                  accessibilityRole="button"
                  accessibilityLabel={`الملف ${index + 1}`}
                  accessibilityState={{ selected: index === activeIndex }}
                  onPress={() => onSetActive(index)}
                  style={{
                    width: 56,
                    height: 56,
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: radius.md,
                    borderCurve: "continuous",
                    overflow: "hidden",
                    borderWidth: 2,
                    borderColor: index === activeIndex ? colors.brand : "transparent",
                    backgroundColor: colors.surfaceSunken,
                  }}
                >
                  {attachment.isImage ? (
                    <Image
                      source={attachment.uri}
                      contentFit="cover"
                      style={{ width: "100%", height: "100%" }}
                    />
                  ) : (
                    <IconSymbol name="doc" color={colors.textTertiary} size={20} />
                  )}
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          <View style={{ flexDirection: "row-reverse", alignItems: "flex-end", gap: spacing.sm }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="حذف هذا الملف"
              disabled={sending || !active}
              onPress={() => active && onRemove(active.id)}
              style={({ pressed }) => ({
                width: hitSize.comfortable,
                height: hitSize.comfortable,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: radius.full,
                backgroundColor: colors.surfaceSunken,
                opacity: sending ? 0.4 : pressed ? 0.6 : 1,
              })}
            >
              <IconSymbol name="trash" color={colors.danger} size={20} />
            </Pressable>

            <TextInput
              accessibilityLabel="تعليق على الملف"
              multiline
              editable={!sending}
              placeholder="أضيفي تعليقًا…"
              placeholderTextColor={colors.textTertiary}
              value={active?.caption ?? ""}
              onChangeText={(text) => active && onChangeCaption(active.id, text)}
              style={{
                flex: 1,
                minHeight: hitSize.comfortable,
                maxHeight: 108,
                paddingHorizontal: spacing.lg,
                paddingVertical: spacing.md,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: radius["2xl"],
                borderCurve: "continuous",
                backgroundColor: colors.surfaceSunken,
                ...type.body,
                color: colors.text,
                ...rtlText,
              }}
            />

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="إرسال"
              accessibilityState={{ busy: sending }}
              disabled={sending}
              onPress={onSend}
              style={({ pressed }) => ({
                width: hitSize.comfortable,
                height: hitSize.comfortable,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: radius.full,
                backgroundColor: colors.brand,
                opacity: sending ? 0.6 : pressed ? 0.75 : 1,
              })}
            >
              {sending ? (
                <ActivityIndicator color={colors.onBrand} />
              ) : (
                <IconSymbol name="arrow.up" color={colors.onBrand} size={22} />
              )}
            </Pressable>
          </View>

          <View style={{ height: insets.bottom }} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
