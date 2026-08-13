import { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { hitSize, radius, rtlText, spacing, type } from "@/constants/theme";
import { tapFeedback } from "@/lib/haptics";
import { useTheme } from "@/providers/theme-provider";
import type { SavedReply } from "@/types/api";

/**
 * The team's canned replies (الرسائل الجاهزة).
 *
 * Like the web popup, picking one appends its text to the draft rather than
 * sending — a saved reply is a starting point, and most get a name or a date
 * added before they go out. They arrive with the bootstrap payload, so there
 * is nothing to fetch when the sheet opens.
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
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim();
    if (!needle) return replies;
    return replies.filter(
      (reply) => reply.title.includes(needle) || reply.body.includes(needle),
    );
  }, [replies, query]);

  return (
    <Modal
      visible={open}
      onRequestClose={onClose}
      animationType="slide"
      presentationStyle="pageSheet"
    >
      <View style={{ flex: 1, backgroundColor: colors.background }}>
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

        {replies.length > 5 ? (
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
          data={filtered}
          keyExtractor={(reply) => reply.id}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            padding: spacing.lg,
            paddingBottom: spacing.lg + insets.bottom,
            gap: spacing.sm,
          }}
          ListEmptyComponent={
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
                : "لا توجد رسائل جاهزة بعد — تُضاف من لوحة التحكم."}
            </Text>
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
      </View>
    </Modal>
  );
}
