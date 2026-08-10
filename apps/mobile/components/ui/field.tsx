import { useState } from "react";
import { Pressable, Text, TextInput, type TextInputProps, View } from "react-native";

import { IconSymbol, type IconName } from "@/components/ui/icon-symbol";
import { hitSize, radius, rtlText, spacing, type } from "@/constants/theme";
import { useTheme } from "@/providers/theme-provider";

type Props = TextInputProps & {
  label: string;
  /** Persistent guidance shown under the input. */
  hint?: string;
  error?: string | null;
  icon?: IconName;
  /** Adds a reveal toggle and starts masked. */
  secure?: boolean;
};

/**
 * Labelled text input. The label is always visible rather than living in the
 * placeholder, so it survives typing and screen readers.
 */
export function Field({ label, hint, error, icon, secure, style, ...inputProps }: Props) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const borderColor = error ? colors.danger : focused ? colors.brand : colors.border;

  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={{ ...type.subheadStrong, color: colors.text, ...rtlText }}>{label}</Text>

      <View
        style={{
          flexDirection: "row-reverse",
          alignItems: "center",
          gap: spacing.sm,
          minHeight: hitSize.control,
          paddingHorizontal: spacing.md + 2,
          borderRadius: radius.md,
          borderCurve: "continuous",
          borderWidth: focused || error ? 1.5 : 1,
          borderColor,
          backgroundColor: colors.surface,
        }}
      >
        {icon ? (
          <IconSymbol name={icon} color={focused ? colors.brand : colors.textTertiary} size={18} />
        ) : null}
        <TextInput
          accessibilityLabel={label}
          accessibilityHint={hint}
          placeholderTextColor={colors.textTertiary}
          secureTextEntry={secure ? !revealed : false}
          onFocus={(event) => {
            setFocused(true);
            inputProps.onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            inputProps.onBlur?.(event);
          }}
          {...inputProps}
          style={[
            {
              flex: 1,
              paddingVertical: spacing.md,
              ...type.body,
              color: colors.text,
              ...rtlText,
            },
            style,
          ]}
        />
        {secure ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
            onPress={() => setRevealed((current) => !current)}
            hitSlop={spacing.md}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <IconSymbol
              name={revealed ? "eye.slash" : "eye"}
              color={colors.textTertiary}
              size={19}
            />
          </Pressable>
        ) : null}
      </View>

      {error ? (
        <Text
          selectable
          accessibilityRole="alert"
          style={{ ...type.footnote, color: colors.danger, ...rtlText }}
        >
          {error}
        </Text>
      ) : hint ? (
        <Text style={{ ...type.footnote, color: colors.textTertiary, ...rtlText }}>{hint}</Text>
      ) : null}
    </View>
  );
}

/** Multi-line input with a live character counter. */
export function TextAreaField({
  label,
  value,
  onChangeText,
  maxLength,
  placeholder,
  error,
  minHeight = 130,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  maxLength?: number;
  placeholder?: string;
  error?: string | null;
  minHeight?: number;
}) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);

  return (
    <View style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: "row-reverse", justifyContent: "space-between" }}>
        <Text style={{ ...type.subheadStrong, color: colors.text, ...rtlText }}>{label}</Text>
        {maxLength ? (
          <Text
            style={{
              ...type.caption,
              color: value.length >= maxLength ? colors.danger : colors.textTertiary,
              fontVariant: ["tabular-nums"],
            }}
          >
            {value.length}/{maxLength}
          </Text>
        ) : null}
      </View>
      <TextInput
        accessibilityLabel={label}
        multiline
        maxLength={maxLength}
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          minHeight,
          padding: spacing.md + 2,
          textAlignVertical: "top",
          borderRadius: radius.md,
          borderCurve: "continuous",
          borderWidth: focused || error ? 1.5 : 1,
          borderColor: error ? colors.danger : focused ? colors.brand : colors.border,
          backgroundColor: colors.surface,
          ...type.body,
          color: colors.text,
          ...rtlText,
        }}
      />
      {error ? (
        <Text
          selectable
          accessibilityRole="alert"
          style={{ ...type.footnote, color: colors.danger, ...rtlText }}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}
