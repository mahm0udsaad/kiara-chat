import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { PrimaryButton } from "@/components/primary-button";
import { IconSymbol, type IconName } from "@/components/ui/icon-symbol";
import { radius, rtlText, spacing, type } from "@/constants/theme";
import { useTheme } from "@/providers/theme-provider";

export function LoadingScreen({ label = "جارٍ التحميل…" }: { label?: string }) {
  const { colors } = useTheme();
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{
        flexGrow: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: spacing.md,
      }}
    >
      <ActivityIndicator color={colors.brand} size="large" />
      <Text
        accessibilityRole="progressbar"
        style={{ ...type.callout, color: colors.textSecondary, ...rtlText }}
      >
        {label}
      </Text>
    </ScrollView>
  );
}

/** Circular icon wash used by the empty and error states. */
function StateGlyph({ name, tone }: { name: IconName; tone: "muted" | "danger" }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        width: 64,
        height: 64,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radius.full,
        backgroundColor: tone === "danger" ? colors.dangerSoft : colors.surfaceSunken,
      }}
    >
      <IconSymbol
        name={name}
        size={28}
        color={tone === "danger" ? colors.danger : colors.textTertiary}
      />
    </View>
  );
}

export function ErrorState({
  message,
  onRetry,
  title = "تعذر تحميل البيانات",
}: {
  message: string;
  onRetry?: () => void;
  title?: string;
}) {
  const { colors } = useTheme();
  return (
    <Animated.View
      entering={FadeIn.duration(220)}
      style={{
        flexGrow: 1,
        padding: spacing["2xl"],
        gap: spacing.lg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <StateGlyph name="exclamationmark.triangle" tone="danger" />
      <View style={{ gap: spacing.xs, alignItems: "center" }}>
        <Text style={{ ...type.title3, color: colors.text, ...rtlText, textAlign: "center" }}>
          {title}
        </Text>
        <Text
          selectable
          accessibilityRole="alert"
          style={{
            ...type.callout,
            color: colors.textSecondary,
            ...rtlText,
            textAlign: "center",
          }}
        >
          {message}
        </Text>
      </View>
      {onRetry ? (
        <View style={{ alignSelf: "stretch", maxWidth: 320 }}>
          <PrimaryButton
            label="إعادة المحاولة"
            variant="tinted"
            icon="arrow.clockwise"
            onPress={onRetry}
          />
        </View>
      ) : null}
    </Animated.View>
  );
}

export function EmptyState({
  title,
  detail,
  icon = "tray",
  action,
}: {
  title: string;
  detail: string;
  icon?: IconName;
  action?: { label: string; onPress: () => void };
}) {
  const { colors } = useTheme();
  return (
    <Animated.View
      entering={FadeIn.duration(220)}
      style={{
        flexGrow: 1,
        padding: spacing["3xl"],
        gap: spacing.lg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <StateGlyph name={icon} tone="muted" />
      <View style={{ gap: spacing.xs, alignItems: "center" }}>
        <Text style={{ ...type.title3, color: colors.text, ...rtlText, textAlign: "center" }}>
          {title}
        </Text>
        <Text
          style={{
            ...type.callout,
            color: colors.textSecondary,
            ...rtlText,
            textAlign: "center",
          }}
        >
          {detail}
        </Text>
      </View>
      {action ? (
        <View style={{ alignSelf: "stretch", maxWidth: 320 }}>
          <PrimaryButton label={action.label} variant="tinted" onPress={action.onPress} />
        </View>
      ) : null}
    </Animated.View>
  );
}

/** Inline banner for mutation errors that must not displace the form. */
export function InlineAlert({
  message,
  tone = "danger",
}: {
  message: string;
  tone?: "danger" | "warning" | "info";
}) {
  const { colors } = useTheme();
  const palette = {
    danger: { bg: colors.dangerSoft, fg: colors.onDangerSoft, icon: "exclamationmark.circle" },
    warning: { bg: colors.warningSoft, fg: colors.onWarningSoft, icon: "exclamationmark.triangle" },
    info: { bg: colors.infoSoft, fg: colors.onInfoSoft, icon: "info.circle" },
  }[tone];

  return (
    <View
      accessibilityRole="alert"
      style={{
        flexDirection: "row-reverse",
        alignItems: "flex-start",
        gap: spacing.sm,
        padding: spacing.md,
        borderRadius: radius.md,
        borderCurve: "continuous",
        backgroundColor: palette.bg,
      }}
    >
      <IconSymbol name={palette.icon as IconName} color={palette.fg} size={17} />
      <Text selectable style={{ flex: 1, ...type.footnote, color: palette.fg, ...rtlText }}>
        {message}
      </Text>
    </View>
  );
}
