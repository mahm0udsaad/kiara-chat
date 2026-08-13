import { ActivityIndicator, Pressable, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

import { InlineAlert } from "@/components/screen-state";
import type { BadgeTone } from "@/components/ui/badge";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { hitSize, radius, rtlText, spacing, type } from "@/constants/theme";
import { formatters } from "@/lib/format";
import { tapFeedback } from "@/lib/haptics";
import { useTheme } from "@/providers/theme-provider";
import type {
  ReminderConfirmation,
  ReminderConfirmationStatus,
} from "@/types/api";

const STATUS_META: Record<
  ReminderConfirmationStatus,
  { label: string; tone: BadgeTone }
> = {
  not_recorded: { label: "غير مسجّل", tone: "neutral" },
  awaiting_reply: { label: "لم تؤكد بعد", tone: "warning" },
  confirmed: { label: "أكدت الحضور", tone: "success" },
  cancelled: { label: "ألغت الحجز", tone: "danger" },
};

type QuickStatus = "awaiting_reply" | "confirmed";

export function ReminderConfirmationStrip({
  reminder,
  canEdit,
  pendingStatus,
  error,
  onChange,
}: {
  reminder: ReminderConfirmation;
  canEdit: boolean;
  pendingStatus: QuickStatus | null;
  error: string | null;
  onChange: (status: QuickStatus) => void;
}) {
  const { colors } = useTheme();
  const status = STATUS_META[reminder.status];
  const appointment = new Date(`${reminder.dayKey}T12:00:00+03:00`);

  return (
    <Animated.View
      entering={FadeInDown.duration(240)}
      testID="reminder-confirmation-strip"
      style={{
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.sm,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        backgroundColor: colors.surface,
      }}
    >
      {/* One row, not three. The chat is the point of this screen; the strip
          stays pinned above it, so every extra line it takes is a line of the
          conversation the employee cannot see. The hints below appear only
          when something actually needs saying. */}
      <View
        style={{
          flexDirection: "row-reverse",
          alignItems: "center",
          gap: spacing.sm,
        }}
      >
        <IconSymbol name="bell" color={colors.textTertiary} size={16} />

      <View style={{ flex: 1, gap: 1 }}>
        <Text style={{ ...type.subheadStrong, color: colors.text, ...rtlText }}>
          تأكيد الحضور؟
        </Text>
        {/* The current state stays spelled out here, so the buttons below can
            be icon-only without meaning being carried by colour alone. */}
        <Text
          numberOfLines={1}
          style={{
            ...type.caption,
            fontWeight: "400",
            color: colors.textTertiary,
            ...rtlText,
          }}
        >
          {`${formatters.shortDate.format(appointment)} · ${status.label}`}
        </Text>
      </View>

      <View style={{ flexDirection: "row-reverse", gap: spacing.xs + 2 }}>
        {(
          [
            { value: "confirmed", label: "أكدت الحضور", icon: "checkmark.circle" },
            { value: "awaiting_reply", label: "لم تؤكد بعد", icon: "hourglass" },
          ] as const
        ).map((option) => {
          const selected = reminder.status === option.value;
          const busy = pendingStatus === option.value;
          const backgroundColor = selected
            ? option.value === "confirmed"
              ? colors.successSoft
              : colors.warningSoft
            : colors.surfaceSunken;
          const foregroundColor = selected
            ? option.value === "confirmed"
              ? colors.onSuccessSoft
              : colors.onWarningSoft
            : colors.textSecondary;
          return (
            <Pressable
              key={option.value}
              testID={`reminder-confirmation-${option.value}`}
              accessibilityRole="button"
              accessibilityLabel={option.label}
              accessibilityState={{ selected, disabled: !canEdit || Boolean(pendingStatus) }}
              disabled={!canEdit || Boolean(pendingStatus)}
              onPress={() => {
                if (selected) return;
                tapFeedback();
                onChange(option.value);
              }}
              // Square 44pt targets: the label moved into accessibilityLabel so
              // the control keeps its full touch area without its full width.
              style={({ pressed }) => ({
                width: hitSize.min,
                height: hitSize.min,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: radius.md,
                borderCurve: "continuous",
                borderWidth: selected ? 1 : 0,
                borderColor: foregroundColor,
                backgroundColor,
                opacity: !canEdit ? 0.5 : pressed ? 0.72 : 1,
              })}
            >
              {busy ? (
                <ActivityIndicator size="small" color={foregroundColor} />
              ) : (
                <IconSymbol name={option.icon} color={foregroundColor} size={18} />
              )}
            </Pressable>
          );
        })}
        </View>
      </View>

      {!canEdit ? (
        <Text
          style={{
            ...type.caption,
            color: colors.textTertiary,
            paddingTop: spacing.xs,
            ...rtlText,
          }}
        >
          استلمي المحادثة أولاً لتحديث تأكيد العميلة.
        </Text>
      ) : null}
      {error ? (
        <View style={{ paddingTop: spacing.xs }}>
          <InlineAlert message={error} />
        </View>
      ) : null}
    </Animated.View>
  );
}
