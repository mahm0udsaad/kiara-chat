import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { IconSymbol, type IconName } from "@/components/ui/icon-symbol";
import { hitSize, radius, rtlText, spacing, type } from "@/constants/theme";
import { commitFeedback } from "@/lib/haptics";
import { useTheme } from "@/providers/theme-provider";

type Props = {
  label: string;
  onPress: () => void;
  testID?: string;
  loading?: boolean;
  /**
   * What the button says while it works. A bare spinner tells the employee
   * that something is happening but not what, and on a call that takes several
   * seconds she cannot tell a slow reply from a stuck screen.
   */
  loadingLabel?: string;
  disabled?: boolean;
  /** Exactly one filled button per view section. */
  variant?: "filled" | "tinted" | "outline" | "plain";
  tone?: "brand" | "danger" | "success";
  icon?: IconName;
  /** Disables the medium impact tap — use for non-committal actions. */
  silent?: boolean;
};

export function PrimaryButton({
  label,
  onPress,
  testID,
  loading = false,
  loadingLabel,
  disabled = false,
  variant = "filled",
  tone = "brand",
  icon,
  silent = false,
}: Props) {
  const { colors } = useTheme();
  const blocked = disabled || loading;

  const accent =
    tone === "danger" ? colors.danger : tone === "success" ? colors.success : colors.brand;
  const accentSoft =
    tone === "danger"
      ? colors.dangerSoft
      : tone === "success"
        ? colors.successSoft
        : colors.brandSoft;
  const onSoft =
    tone === "danger"
      ? colors.onDangerSoft
      : tone === "success"
        ? colors.onSuccessSoft
        : colors.onBrandSoft;

  const surface = {
    filled: { background: accent, foreground: colors.onBrand, border: "transparent" },
    tinted: { background: accentSoft, foreground: onSoft, border: "transparent" },
    outline: { background: "transparent", foreground: accent, border: accent },
    plain: { background: "transparent", foreground: accent, border: "transparent" },
  }[variant];

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: blocked, busy: loading }}
      disabled={blocked}
      onPress={() => {
        if (!silent) commitFeedback();
        onPress();
      }}
      style={({ pressed }) => ({
        minHeight: hitSize.control,
        flexDirection: "row-reverse",
        alignItems: "center",
        justifyContent: "center",
        gap: spacing.sm,
        paddingHorizontal: spacing.xl,
        borderRadius: radius.lg,
        borderCurve: "continuous",
        borderWidth: variant === "outline" ? 1.5 : 0,
        borderColor: surface.border,
        backgroundColor: surface.background,
        opacity: blocked ? 0.45 : pressed ? 0.8 : 1,
        transform: [{ scale: pressed && !blocked ? 0.985 : 1 }],
      })}
    >
      {loading ? (
        <>
          <ActivityIndicator color={surface.foreground} />
          {loadingLabel ? (
            <Text style={{ ...type.bodyStrong, color: surface.foreground, ...rtlText }}>
              {loadingLabel}
            </Text>
          ) : null}
        </>
      ) : (
        <>
          {icon ? <IconSymbol name={icon} color={surface.foreground} size={18} /> : null}
          <Text style={{ ...type.bodyStrong, color: surface.foreground, ...rtlText }}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

/**
 * Bottom-docked action bar. Keeps primary actions inside the thumb zone and
 * adds the home-indicator inset so nothing sits under the gesture bar.
 */
export function ActionBar({
  children,
  bottomInset = 0,
}: {
  children: React.ReactNode;
  bottomInset?: number;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        gap: spacing.sm,
        paddingHorizontal: spacing.lg,
        paddingTop: spacing.md,
        paddingBottom: spacing.md + bottomInset,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        backgroundColor: colors.surface,
      }}
    >
      {children}
    </View>
  );
}
