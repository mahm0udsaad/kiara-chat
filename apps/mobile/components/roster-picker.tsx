import { useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { Avatar } from "@/components/ui/avatar";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { hitSize, radius, rtlText, spacing, type } from "@/constants/theme";
import { tapFeedback } from "@/lib/haptics";
import { useTheme } from "@/providers/theme-provider";
import type { RosterOption } from "@/types/api";

type Props = {
  label: string;
  options: RosterOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  allowEmpty?: boolean;
  error?: string | null;
  /** Rosters longer than this get an inline filter box. */
  searchThreshold?: number;
};

/**
 * Picks one person from a roster. Rendered as a list of rows rather than chips:
 * names wrap unpredictably in Arabic, and rows keep every target a full-width
 * 48pt hit area with the selection state readable at a glance.
 */
export function RosterPicker({
  label,
  options,
  value,
  onChange,
  allowEmpty = false,
  error,
  searchThreshold = 6,
}: Props) {
  const { colors } = useTheme();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim();
    if (!needle) return options;
    return options.filter(
      (option) =>
        option.full_name.includes(needle) || (option.phone ?? "").includes(needle),
    );
  }, [options, query]);

  const rows: (RosterOption | null)[] = allowEmpty ? [null, ...filtered] : filtered;

  return (
    <View style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: "row-reverse", justifyContent: "space-between" }}>
        <Text style={{ ...type.subheadStrong, color: colors.text, ...rtlText }}>{label}</Text>
        <Text style={{ ...type.caption, color: colors.textTertiary, fontVariant: ["tabular-nums"] }}>
          {options.length}
        </Text>
      </View>

      {options.length >= searchThreshold ? (
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
            accessibilityLabel={`بحث في ${label}`}
            placeholder="بحث بالاسم أو الرقم"
            placeholderTextColor={colors.textTertiary}
            value={query}
            onChangeText={setQuery}
            style={{ flex: 1, ...type.callout, color: colors.text, ...rtlText }}
          />
        </View>
      ) : null}

      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
        style={{
          borderRadius: radius.lg,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: error ? colors.danger : colors.border,
          backgroundColor: colors.surface,
          overflow: "hidden",
        }}
      >
        {rows.length === 0 ? (
          <Text
            style={{
              padding: spacing.lg,
              ...type.footnote,
              color: colors.textTertiary,
              ...rtlText,
            }}
          >
            لا توجد نتائج مطابقة
          </Text>
        ) : (
          rows.map((option, index) => {
            const optionValue = option?.id ?? null;
            const selected = optionValue === value;
            const name = option?.full_name ?? "بدون اختيار";
            return (
              <Pressable
                key={optionValue ?? "empty"}
                accessibilityRole="radio"
                accessibilityLabel={name}
                accessibilityState={{ selected }}
                onPress={() => {
                  tapFeedback();
                  onChange(optionValue);
                }}
                style={({ pressed }) => ({
                  minHeight: hitSize.comfortable + 8,
                  flexDirection: "row-reverse",
                  alignItems: "center",
                  gap: spacing.md,
                  paddingHorizontal: spacing.md + 2,
                  paddingVertical: spacing.sm,
                  borderTopWidth: index === 0 ? 0 : 1,
                  borderTopColor: colors.border,
                  backgroundColor: selected
                    ? colors.brandSoft
                    : pressed
                      ? colors.surfaceSunken
                      : colors.surface,
                })}
              >
                {option ? (
                  <Avatar name={option.full_name} seed={option.phone ?? option.id} size={34} />
                ) : (
                  <View
                    style={{
                      width: 34,
                      height: 34,
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: radius.full,
                      backgroundColor: colors.surfaceSunken,
                    }}
                  >
                    <IconSymbol name="person.crop.circle" color={colors.textTertiary} size={18} />
                  </View>
                )}

                <View style={{ flex: 1, gap: 2 }}>
                  <Text
                    numberOfLines={1}
                    style={{
                      ...type.calloutStrong,
                      color: selected ? colors.onBrandSoft : colors.text,
                      ...rtlText,
                    }}
                  >
                    {name}
                  </Text>
                  {option?.phone ? (
                    <Text
                      style={{
                        ...type.caption,
                        color: colors.textTertiary,
                        fontVariant: ["tabular-nums"],
                        ...rtlText,
                      }}
                    >
                      {option.phone}
                    </Text>
                  ) : null}
                </View>

                {selected ? (
                  <IconSymbol name="checkmark.circle" color={colors.brand} size={21} />
                ) : null}
              </Pressable>
            );
          })
        )}
      </View>

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
