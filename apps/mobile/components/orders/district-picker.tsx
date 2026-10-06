import { useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { hitSize, numeric, radius, rtlText, spacing, type } from "@/constants/theme";
import { tapFeedback } from "@/lib/haptics";
import { useTheme } from "@/providers/theme-provider";
import type { District } from "@/types/api";

const priceFormatter = new Intl.NumberFormat("ar-SA", {
  style: "currency",
  currency: "SAR",
  maximumFractionDigits: 2,
});

/**
 * Picks the customer's district, which prices the trip. Always optional: the
 * first row is "بدون حي", and an order without one simply has no cost yet.
 *
 * Fares show only when the list carries them — the server sends them to
 * admins and strips them for everyone else.
 */
export function DistrictPicker({
  label = "الحي (اختياري)",
  districts,
  value,
  onChange,
  currentName,
  hint,
  disabled = false,
}: {
  label?: string;
  districts: District[];
  value: string | null;
  onChange: (id: string | null) => void;
  /** The order's own district when it has since been archived. */
  currentName?: string | null;
  hint?: string;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const [query, setQuery] = useState("");

  const options = useMemo(() => {
    const list = [...districts];
    // An archived district stays visible on the order that already uses it.
    if (value && !list.some((item) => item.id === value)) {
      list.unshift({
        id: value,
        name: currentName ?? "حي موقوف",
        trip_price: null,
        is_active: false,
      });
    }
    const needle = query.trim();
    return needle ? list.filter((item) => item.name.includes(needle)) : list;
  }, [currentName, districts, query, value]);

  const rows: (District | null)[] = query.trim() ? options : [null, ...options];

  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={{ ...type.subheadStrong, color: colors.text, ...rtlText }}>{label}</Text>

      {districts.length >= 8 ? (
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
            accessibilityLabel="بحث في الأحياء"
            placeholder="بحث باسم الحي"
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
          borderColor: colors.border,
          backgroundColor: colors.surface,
          overflow: "hidden",
          opacity: disabled ? 0.6 : 1,
        }}
      >
        {rows.length === 0 ? (
          <Text style={{ padding: spacing.lg, ...type.footnote, color: colors.textTertiary, ...rtlText }}>
            {districts.length ? "لا توجد نتائج مطابقة" : "لم تُضف الإدارة أي حي بعد."}
          </Text>
        ) : (
          rows.map((district, index) => {
            const id = district?.id ?? null;
            const selected = id === value;
            const name = district?.name ?? "بدون حي";
            return (
              <Pressable
                key={id ?? "none"}
                accessibilityRole="radio"
                accessibilityLabel={
                  district?.trip_price != null
                    ? `${name}، ${district.trip_price} ريال`
                    : name
                }
                accessibilityState={{ selected, disabled }}
                disabled={disabled}
                onPress={() => {
                  tapFeedback();
                  onChange(id);
                }}
                style={({ pressed }) => ({
                  minHeight: hitSize.comfortable,
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
                <Text
                  numberOfLines={1}
                  style={{
                    flex: 1,
                    ...type.calloutStrong,
                    color: selected
                      ? colors.onBrandSoft
                      : district
                        ? colors.text
                        : colors.textSecondary,
                    ...rtlText,
                  }}
                >
                  {name}
                </Text>
                {district?.trip_price != null ? (
                  <Text style={{ ...type.footnote, ...numeric, color: colors.brand }}>
                    {priceFormatter.format(district.trip_price)}
                  </Text>
                ) : null}
                {selected ? (
                  <IconSymbol name="checkmark.circle" color={colors.brand} size={21} />
                ) : null}
              </Pressable>
            );
          })
        )}
      </View>

      {hint ? (
        <Text style={{ ...type.caption, color: colors.textTertiary, ...rtlText }}>{hint}</Text>
      ) : null}
    </View>
  );
}
