import { useMemo, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Pressable,
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
import { useCreateSavedReply } from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";
import type { SavedReply } from "@/types/api";

/**
 * Openers the team writes over and over. Tapping one drops it into the new
 * reply's body so it can be edited before saving — the salon's own wording is
 * never the same as a starter.
 */
const WELCOME_STARTERS: { title: string; body: string }[] = [
  {
    title: "ترحيب",
    body: "أهلًا وسهلًا بك في كيارا 🌸 كيف أقدر أساعدك اليوم؟",
  },
  {
    title: "ترحيب بعميلة جديدة",
    body: "أهلًا بك 🌸 سعداء بتواصلك معنا لأول مرة. تحبين أشرح لك الباقات والخدمات المتوفرة؟",
  },
  {
    title: "ترحيب بعد التحية",
    body: "هلا وغلا 🌸 أنا معك الحين، تفضلي بطلبك وأخدمك على طول.",
  },
];

const TITLE_MAX = 60;
const BODY_MAX = 1000;

/**
 * The team's canned replies (الرسائل الجاهزة).
 *
 * Like the web popup, picking one appends its text to the draft rather than
 * sending — a saved reply is a starting point, and most get a name or a date
 * added before they go out. They arrive with the bootstrap payload, so there
 * is nothing to fetch when the sheet opens.
 *
 * New ones are written here too: a welcome line is rewritten on the floor, and
 * sending someone to the dashboard for it means it never gets saved at all.
 */
export function SavedRepliesSheet({
  open,
  replies,
  onClose,
  onPick,
}: {
  open: boolean;
  replies: SavedReply[];
  onClose: () => void;
  onPick: (reply: SavedReply) => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const create = useCreateSavedReply();
  const [query, setQuery] = useState("");
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [validation, setValidation] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim();
    if (!needle) return replies;
    return replies.filter(
      (reply) => reply.title.includes(needle) || reply.body.includes(needle),
    );
  }, [replies, query]);

  const closeComposer = () => {
    setComposing(false);
    setTitle("");
    setBody("");
    setValidation(null);
    create.reset();
  };

  const save = () => {
    if (!title.trim()) {
      setValidation("اكتبي عنوانًا مختصرًا للرسالة.");
      return;
    }
    if (!body.trim()) {
      setValidation("نص الرسالة مطلوب.");
      return;
    }
    setValidation(null);
    create.mutate(
      { title: title.trim(), body: body.trim() },
      {
        onSuccess: ({ savedReply }) => {
          successFeedback();
          closeComposer();
          // Straight into the draft: the reason she wrote it now is that she
          // needs to send it now.
          onPick(savedReply);
          onClose();
        },
      },
    );
  };

  const inputStyle = {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderCurve: "continuous" as const,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.text,
    ...type.callout,
    ...rtlText,
  };

  return (
    <Modal
      visible={open}
      onRequestClose={onClose}
      animationType="slide"
      presentationStyle="pageSheet"
    >
      <KeyboardAvoidingView
        behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined}
        style={{ flex: 1, backgroundColor: colors.background }}
      >
        <View
          style={{
            flexDirection: "row-reverse",
            alignItems: "center",
            justifyContent: "space-between",
            gap: spacing.md,
            paddingHorizontal: spacing.lg,
            paddingTop: spacing.lg,
            paddingBottom: spacing.md,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
            backgroundColor: colors.surface,
          }}
        >
          <Text style={{ ...type.title3, color: colors.text, ...rtlText }}>الرسائل الجاهزة</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="إغلاق"
            onPress={onClose}
            style={({ pressed }) => ({
              width: hitSize.min,
              height: hitSize.min,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: radius.full,
              backgroundColor: colors.surfaceSunken,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <IconSymbol name="xmark" color={colors.textSecondary} size={18} />
          </Pressable>
        </View>

        {replies.length > 5 && !composing ? (
          <View
            style={{
              paddingHorizontal: spacing.lg,
              paddingVertical: spacing.md,
              backgroundColor: colors.surface,
            }}
          >
            <View
              style={{
                flexDirection: "row-reverse",
                alignItems: "center",
                gap: spacing.sm,
                minHeight: hitSize.min,
                paddingHorizontal: spacing.md,
                borderRadius: radius.md,
                borderCurve: "continuous",
                backgroundColor: colors.surfaceSunken,
              }}
            >
              <IconSymbol name="magnifyingglass" color={colors.textTertiary} size={17} />
              <TextInput
                accessibilityLabel="بحث في الرسائل الجاهزة"
                placeholder="ابحثي عن رسالة…"
                placeholderTextColor={colors.textTertiary}
                value={query}
                onChangeText={setQuery}
                style={{ flex: 1, ...type.callout, color: colors.text, ...rtlText }}
              />
            </View>
          </View>
        ) : null}

        <FlatList
          data={composing ? [] : filtered}
          keyExtractor={(reply) => reply.id}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            padding: spacing.lg,
            paddingBottom: spacing.lg + insets.bottom,
            gap: spacing.sm,
          }}
          ListHeaderComponent={
            composing ? (
              <View style={{ gap: spacing.md }}>
                <Text style={{ ...type.headline, color: colors.text, ...rtlText }}>
                  رسالة جاهزة جديدة
                </Text>

                {/* Welcome lines are what gets written from the phone, so the
                    starters sit above the fields rather than in a submenu. */}
                <View style={{ gap: spacing.sm }}>
                  <Text
                    style={{ ...type.subheadStrong, color: colors.text, ...rtlText }}
                  >
                    ابدئي من صيغة ترحيب
                  </Text>
                  <View
                    style={{
                      flexDirection: "row-reverse",
                      flexWrap: "wrap",
                      gap: spacing.sm,
                    }}
                  >
                    {WELCOME_STARTERS.map((starter) => (
                      <Pressable
                        key={starter.title}
                        accessibilityRole="button"
                        accessibilityLabel={`استخدام صيغة ${starter.title}`}
                        onPress={() => {
                          tapFeedback();
                          setTitle(starter.title);
                          setBody(starter.body);
                          setValidation(null);
                        }}
                        style={({ pressed }) => ({
                          minHeight: hitSize.min - 8,
                          justifyContent: "center",
                          paddingHorizontal: spacing.md,
                          borderRadius: radius.full,
                          borderWidth: 1,
                          borderColor: pressed ? colors.brand : colors.border,
                          backgroundColor: pressed ? colors.brandSoft : colors.surface,
                        })}
                      >
                        <Text
                          style={{
                            ...type.footnote,
                            color: colors.textSecondary,
                            ...rtlText,
                          }}
                        >
                          {starter.title}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>

                <View style={{ gap: spacing.sm }}>
                  <Text
                    style={{ ...type.subheadStrong, color: colors.text, ...rtlText }}
                  >
                    العنوان
                  </Text>
                  <TextInput
                    accessibilityLabel="عنوان الرسالة الجاهزة"
                    placeholder="مثال: ترحيب"
                    placeholderTextColor={colors.textTertiary}
                    value={title}
                    onChangeText={setTitle}
                    maxLength={TITLE_MAX}
                    style={{ minHeight: hitSize.control, ...inputStyle }}
                  />
                </View>

                <View style={{ gap: spacing.sm }}>
                  <View
                    style={{
                      flexDirection: "row-reverse",
                      justifyContent: "space-between",
                    }}
                  >
                    <Text
                      style={{ ...type.subheadStrong, color: colors.text, ...rtlText }}
                    >
                      نص الرسالة
                    </Text>
                    <Text
                      style={{
                        ...type.caption,
                        color:
                          body.length >= BODY_MAX ? colors.danger : colors.textTertiary,
                        fontVariant: ["tabular-nums"],
                      }}
                    >
                      {body.length}/{BODY_MAX}
                    </Text>
                  </View>
                  <TextInput
                    accessibilityLabel="نص الرسالة الجاهزة"
                    multiline
                    placeholder="اكتبي الرسالة كما تُرسل للعميلة…"
                    placeholderTextColor={colors.textTertiary}
                    value={body}
                    onChangeText={setBody}
                    maxLength={BODY_MAX}
                    style={{ minHeight: 120, textAlignVertical: "top", ...inputStyle }}
                  />
                </View>

                {validation ? <InlineAlert message={validation} /> : null}
                {create.error ? <InlineAlert message={create.error.message} /> : null}

                <PrimaryButton
                  label="حفظ وإدراج في الرد"
                  icon="checkmark.circle"
                  loading={create.isPending}
                  onPress={save}
                />
                <PrimaryButton
                  label="إلغاء"
                  variant="plain"
                  silent
                  onPress={closeComposer}
                />
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="إضافة رسالة جاهزة جديدة"
                onPress={() => {
                  tapFeedback();
                  setComposing(true);
                }}
                style={({ pressed }) => ({
                  flexDirection: "row-reverse",
                  alignItems: "center",
                  gap: spacing.sm,
                  minHeight: hitSize.control,
                  paddingHorizontal: spacing.md,
                  marginBottom: spacing.xs,
                  borderRadius: radius.lg,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderStyle: "dashed",
                  borderColor: pressed ? colors.brand : colors.borderStrong,
                  backgroundColor: pressed ? colors.brandSoft : "transparent",
                })}
              >
                <IconSymbol name="plus" color={colors.brand} size={17} />
                <Text style={{ ...type.calloutStrong, color: colors.brand, ...rtlText }}>
                  رسالة جاهزة جديدة
                </Text>
              </Pressable>
            )
          }
          ListEmptyComponent={
            composing ? null : (
              <Text
                style={{
                  ...type.callout,
                  color: colors.textTertiary,
                  textAlign: "center",
                  paddingVertical: spacing["3xl"],
                }}
              >
                {replies.length
                  ? "لا نتائج مطابقة."
                  : "لا توجد رسائل جاهزة بعد — أضيفي أول رسالة من الزر أعلاه."}
              </Text>
            )
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={item.title}
              onPress={() => {
                tapFeedback();
                onPick(item);
                onClose();
              }}
              style={({ pressed }) => ({
                gap: spacing.xs,
                padding: spacing.md,
                borderRadius: radius.lg,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor: pressed ? colors.brand : colors.border,
                backgroundColor: pressed ? colors.brandSoft : colors.surface,
              })}
            >
              <Text style={{ ...type.calloutStrong, color: colors.text, ...rtlText }}>
                {item.title}
              </Text>
              <Text
                numberOfLines={3}
                style={{ ...type.footnote, color: colors.textSecondary, ...rtlText }}
              >
                {item.body}
              </Text>
            </Pressable>
          )}
        />
      </KeyboardAvoidingView>
    </Modal>
  );
}
