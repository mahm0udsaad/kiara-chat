import { useQueryClient } from "@tanstack/react-query";
import { memo } from "react";
import { Pressable, Text, View } from "react-native";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { hitSize, radius, rtlText, spacing, type } from "@/constants/theme";
import { formatters } from "@/lib/format";
import { tapFeedback } from "@/lib/haptics";
import { discardOutboxEntry, retryOutboxEntry } from "@/lib/outbox";
import type { OutboxEntry } from "@/lib/outbox-core";
import { useTheme } from "@/providers/theme-provider";

/**
 * Her own reply before the thread has the server's copy: sending, or failed
 * with the reason and a retry. Drawn like any reply she sent, so nothing
 * jumps when the real message takes its place.
 */
export const OutboxBubble = memo(function OutboxBubble({ entry }: { entry: OutboxEntry }) {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const failed = entry.state === "failed";

  return (
    <View
      style={{
        maxWidth: "84%",
        alignSelf: "flex-start",
        paddingHorizontal: spacing.md + 2,
        paddingVertical: spacing.sm + 2,
        gap: spacing.xs,
        borderRadius: radius.lg + 2,
        borderCurve: "continuous",
        borderBottomStartRadius: radius.sm - 2,
        borderBottomEndRadius: radius.lg + 2,
        backgroundColor: colors.brand,
        opacity: failed ? 0.7 : 0.85,
      }}
    >
      <Text
        selectable
        textBreakStrategy="simple"
        style={{ ...type.body, color: colors.onBrand, ...rtlText }}
      >
        {entry.text}
      </Text>
      <Text
        style={{
          ...type.caption,
          fontWeight: "400",
          opacity: 0.75,
          color: colors.onBrand,
          fontVariant: ["tabular-nums"],
          textAlign: "left",
        }}
      >
        {formatters.time.format(new Date(entry.createdAt))}
      </Text>

      <View
        accessibilityRole="text"
        accessibilityLabel={failed ? "لم يتم الإرسال" : "جارٍ الإرسال"}
        style={{
          alignSelf: "flex-start",
          flexDirection: "row-reverse",
          alignItems: "center",
          gap: spacing.xs,
          paddingHorizontal: spacing.sm,
          paddingVertical: 2,
          borderRadius: radius.full,
          backgroundColor: failed ? colors.dangerSoft : colors.surfaceSunken,
        }}
      >
        <IconSymbol
          name={failed ? "exclamationmark.circle" : "clock"}
          color={failed ? colors.onDangerSoft : colors.textSecondary}
          size={13}
        />
        <Text
          style={{
            ...type.caption,
            color: failed ? colors.onDangerSoft : colors.textSecondary,
            ...rtlText,
          }}
        >
          {failed ? "لم يتم الإرسال" : "جارٍ الإرسال"}
        </Text>
      </View>

      {failed ? (
        <>
          {entry.error ? (
            <Text style={{ ...type.caption, color: colors.onBrand, ...rtlText }}>
              {entry.error}
            </Text>
          ) : null}
          <View style={{ flexDirection: "row-reverse", gap: spacing.sm }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="إعادة المحاولة"
              onPress={() => {
                tapFeedback();
                retryOutboxEntry(entry.key, queryClient);
              }}
              style={({ pressed }) => ({
                minHeight: hitSize.min - 8,
                paddingHorizontal: spacing.md,
                flexDirection: "row-reverse",
                alignItems: "center",
                gap: spacing.xs,
                borderRadius: radius.full,
                backgroundColor: colors.surface,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <IconSymbol name="arrow.clockwise" color={colors.brand} size={14} />
              <Text style={{ ...type.footnote, fontWeight: "600", color: colors.brand, ...rtlText }}>
                إعادة المحاولة
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="حذف الرسالة غير المرسلة"
              onPress={() => {
                tapFeedback();
                discardOutboxEntry(entry.key);
              }}
              style={({ pressed }) => ({
                minHeight: hitSize.min - 8,
                paddingHorizontal: spacing.md,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: radius.full,
                opacity: pressed ? 0.6 : 0.9,
              })}
            >
              <Text style={{ ...type.footnote, color: colors.onBrand, ...rtlText }}>حذف</Text>
            </Pressable>
          </View>
        </>
      ) : null}
    </View>
  );
});
