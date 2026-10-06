import { Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { IconSymbol, type IconName } from "@/components/ui/icon-symbol";
import { hitSize, radius, rtlText, spacing, type } from "@/constants/theme";
import { tapFeedback } from "@/lib/haptics";
import { useTheme } from "@/providers/theme-provider";

export type SheetOption = {
  key: string;
  label: string;
  /** One short line under the label: what happens when it is chosen. */
  detail?: string;
  icon: IconName;
  disabled?: boolean;
  onPress: () => void;
};

/**
 * A bottom sheet of secondary actions behind one "more" button, so a screen
 * keeps a single primary action in view instead of a stack of full-width
 * buttons. Choosing an option closes the sheet first, then runs it.
 */
export function OptionsSheet({
  visible,
  title,
  options,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: SheetOption[];
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: colors.overlay }}>
        <Pressable accessibilityLabel="إغلاق" style={{ flex: 1 }} onPress={onClose} />
        <View
          style={{
            paddingTop: spacing.md,
            paddingHorizontal: spacing.lg,
            paddingBottom: insets.bottom + spacing.lg,
            gap: spacing.xs,
            borderTopLeftRadius: radius["2xl"],
            borderTopRightRadius: radius["2xl"],
            borderCurve: "continuous",
            backgroundColor: colors.surface,
          }}
        >
          <View
            style={{
              alignSelf: "center",
              width: 36,
              height: 5,
              borderRadius: 3,
              marginBottom: spacing.sm,
              backgroundColor: colors.borderStrong,
            }}
          />
          <Text style={{ ...type.subheadStrong, color: colors.textSecondary, ...rtlText, paddingBottom: spacing.xs }}>
            {title}
          </Text>
          {options.map((option) => (
            <Pressable
              key={option.key}
              accessibilityRole="button"
              accessibilityLabel={option.detail ? `${option.label}. ${option.detail}` : option.label}
              accessibilityState={{ disabled: option.disabled }}
              disabled={option.disabled}
              onPress={() => {
                tapFeedback();
                onClose();
                option.onPress();
              }}
              style={({ pressed }) => ({
                minHeight: hitSize.comfortable,
                flexDirection: "row-reverse",
                alignItems: "center",
                gap: spacing.md,
                paddingVertical: spacing.sm,
                paddingHorizontal: spacing.sm,
                borderRadius: radius.md,
                backgroundColor: pressed ? colors.surfaceSunken : "transparent",
                opacity: option.disabled ? 0.45 : 1,
              })}
            >
              <View
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: radius.full,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: colors.brandSoft,
                }}
              >
                <IconSymbol name={option.icon} color={colors.onBrandSoft} size={18} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ ...type.bodyStrong, color: colors.text, ...rtlText }}>{option.label}</Text>
                {option.detail ? (
                  <Text style={{ ...type.footnote, color: colors.textSecondary, ...rtlText }}>
                    {option.detail}
                  </Text>
                ) : null}
              </View>
              <IconSymbol name="chevron.left" color={colors.textTertiary} size={14} />
            </Pressable>
          ))}
        </View>
      </View>
    </Modal>
  );
}
