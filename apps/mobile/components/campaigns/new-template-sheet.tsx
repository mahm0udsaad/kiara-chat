import { useMemo, useState } from "react";
import {
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
import { hitSize, radius, rtlText, spacing, type } from "@/constants/theme";
import { successFeedback, tapFeedback } from "@/lib/haptics";
import { useCreateCampaignTemplate } from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";

type ContentType = "text" | "media" | "quick_reply" | "call_to_action";

const TYPES: { key: ContentType; label: string; hint: string }[] = [
  { key: "text", label: "نص", hint: "رسالة نصية فقط" },
  { key: "media", label: "صورة/وسائط", hint: "نص مع صورة أو ملف" },
  { key: "quick_reply", label: "أزرار رد سريع", hint: "نص مع أزرار للرد" },
  { key: "call_to_action", label: "أزرار إجراء", hint: "رابط أو اتصال" },
];

const CATEGORIES = [
  { key: "MARKETING", label: "تسويقي" },
  { key: "UTILITY", label: "خدمي" },
];

/**
 * Create a WhatsApp template and submit it for Meta approval, from the phone.
 * The four business-initiated marketing shapes Twilio's Content API accepts.
 */
export function NewTemplateSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const create = useCreateCampaignTemplate();

  const [name, setName] = useState("");
  const [contentType, setContentType] = useState<ContentType>("text");
  const [category, setCategory] = useState("MARKETING");
  const [body, setBody] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [buttons, setButtons] = useState<string[]>(["", ""]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const reset = () => {
    setName(""); setContentType("text"); setCategory("MARKETING");
    setBody(""); setMediaUrl(""); setButtons(["", ""]); setError(null); setDone(null);
  };
  const close = () => { reset(); onClose(); };

  const slug = useMemo(
    () => name.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, ""),
    [name],
  );

  const submit = () => {
    setError(null);
    if (!slug) return setError("اكتبي اسمًا بالإنجليزية للقالب.");
    if (!body.trim()) return setError("نص الرسالة مطلوب.");
    if (contentType === "media" && !mediaUrl.trim())
      return setError("رابط الصورة/الملف مطلوب لهذا النوع.");
    const btns = buttons.map((b) => b.trim()).filter(Boolean);
    if ((contentType === "quick_reply" || contentType === "call_to_action") && !btns.length)
      return setError("أضيفي زرًّا واحدًا على الأقل.");

    create.mutate(
      {
        name: slug,
        contentType,
        category,
        body: body.trim(),
        ...(contentType === "media" ? { mediaUrl: mediaUrl.trim() } : {}),
        ...(contentType === "quick_reply"
          ? { quickReplies: btns.map((t, i) => ({ title: t, id: `btn_${i + 1}` })) }
          : {}),
        ...(contentType === "call_to_action"
          ? { ctaButtons: btns.map((t) => ({ type: "URL", title: t, url: "https://wa.me/966508421748" })) }
          : {}),
      },
      {
        onSuccess: () => {
          successFeedback();
          setDone("تم إرسال القالب للمراجعة. ستظهر حالته (قيد المراجعة → معتمد) في القائمة.");
        },
        onError: (e: Error) => setError(e.message),
      },
    );
  };

  const needsButtons = contentType === "quick_reply" || contentType === "call_to_action";

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <Pressable
          onPress={close}
          style={{ flex: 1, justifyContent: "flex-end", backgroundColor: colors.overlay }}
        >
          <Pressable
            onPress={() => {}}
            style={{
              maxHeight: "92%",
              padding: spacing.lg,
              paddingBottom: spacing.lg + insets.bottom,
              gap: spacing.md,
              borderTopLeftRadius: radius["2xl"],
              borderTopRightRadius: radius["2xl"],
              backgroundColor: colors.surface,
            }}
          >
            <Text style={{ ...type.title3, color: colors.text, ...rtlText }}>قالب جديد</Text>
            {error ? <InlineAlert message={error} /> : null}
            {done ? (
              <View
                style={{
                  gap: spacing.md,
                  padding: spacing.lg,
                  borderRadius: radius.lg,
                  backgroundColor: colors.surfaceSunken,
                }}
              >
                <Text style={{ ...type.body, color: colors.text, ...rtlText }}>{done}</Text>
                <PrimaryButton label="تم" onPress={close} />
              </View>
            ) : (
              <ScrollView keyboardShouldPersistTaps="handled">
                <View style={{ gap: spacing.md }}>
                  <Field label="اسم القالب (بالإنجليزية)">
                    <Input value={name} onChangeText={setName} placeholder="offer_ramadan" />
                    {slug ? (
                      <Text style={{ ...type.caption, color: colors.textTertiary }}>{slug}</Text>
                    ) : null}
                  </Field>

                  <Field label="النوع">
                    <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: spacing.xs }}>
                      {TYPES.map((t) => (
                        <Chip
                          key={t.key}
                          label={t.label}
                          active={contentType === t.key}
                          onPress={() => { tapFeedback(); setContentType(t.key); }}
                        />
                      ))}
                    </View>
                  </Field>

                  <Field label="التصنيف">
                    <View style={{ flexDirection: "row-reverse", gap: spacing.xs }}>
                      {CATEGORIES.map((c) => (
                        <Chip
                          key={c.key}
                          label={c.label}
                          active={category === c.key}
                          onPress={() => { tapFeedback(); setCategory(c.key); }}
                        />
                      ))}
                    </View>
                  </Field>

                  <Field label="نص الرسالة">
                    <Input value={body} onChangeText={setBody} placeholder="اكتبي نص الرسالة…" multiline />
                  </Field>

                  {contentType === "media" ? (
                    <Field label="رابط الصورة/الملف (https)">
                      <Input value={mediaUrl} onChangeText={setMediaUrl} placeholder="https://…" />
                    </Field>
                  ) : null}

                  {needsButtons ? (
                    <Field label="الأزرار (حتى زرّين)">
                      {buttons.map((b, i) => (
                        <Input
                          key={i}
                          value={b}
                          onChangeText={(v) => setButtons((p) => p.map((x, j) => (j === i ? v : x)))}
                          placeholder={`زر ${i + 1}`}
                        />
                      ))}
                    </Field>
                  ) : null}

                  <PrimaryButton
                    label={create.isPending ? "جارٍ الإرسال…" : "إرسال للمراجعة"}
                    onPress={submit}
                    disabled={create.isPending}
                  />
                  <Pressable onPress={close} style={{ alignItems: "center", paddingVertical: spacing.sm }}>
                    <Text style={{ ...type.caption, color: colors.textSecondary }}>إلغاء</Text>
                  </Pressable>
                </View>
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );

  function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
      <View style={{ gap: spacing.xs }}>
        <Text style={{ ...type.caption, color: colors.textSecondary, ...rtlText }}>{label}</Text>
        {children}
      </View>
    );
  }
  function Input(props: React.ComponentProps<typeof TextInput>) {
    return (
      <TextInput
        placeholderTextColor={colors.textTertiary}
        {...props}
        style={{
          minHeight: hitSize.comfortable,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.md,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.lg,
          backgroundColor: colors.surfaceSunken,
          ...type.body,
          color: colors.text,
          ...rtlText,
        }}
      />
    );
  }
  function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
    return (
      <Pressable
        onPress={onPress}
        style={{
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.sm,
          borderRadius: radius.full,
          borderWidth: 1,
          borderColor: active ? colors.brand : colors.border,
          backgroundColor: active ? colors.brand : colors.surface,
        }}
      >
        <Text style={{ ...type.caption, color: active ? "#fff" : colors.text }}>{label}</Text>
      </Pressable>
    );
  }
}
