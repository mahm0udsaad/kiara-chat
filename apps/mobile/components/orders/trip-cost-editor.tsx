import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { PrimaryButton } from "@/components/primary-button";
import { InlineAlert } from "@/components/screen-state";
import { Card } from "@/components/ui/card";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { hitSize, numeric, radius, rtlText, spacing, type } from "@/constants/theme";
import { successFeedback } from "@/lib/haptics";
import { useUpdateOrder } from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";

const priceFormatter = new Intl.NumberFormat("ar-SA", {
  style: "currency",
  currency: "SAR",
  maximumFractionDigits: 2,
});

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

const tripCostOptions = [
  { area: "حي الفهد", price: 25 },
  { area: "الفيصليه", price: 25 },
  { area: "القابل", price: 35 },
] as const;

function normalizeNumber(value: string) {
  return value
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)))
    .replace(/[٫,]/g, ".")
    .replace(/\s/g, "");
}

export function TripCostEditor({
  orderId,
  expectedVersion,
  price,
  driverName,
  leg = "outbound",
}: {
  orderId: string;
  expectedVersion: number;
  price: number | null;
  driverName: string | null;
  leg?: "outbound" | "return";
}) {
  const { colors } = useTheme();
  const update = useUpdateOrder(orderId);
  const [value, setValue] = useState(price == null ? "" : String(price));
  const [error, setError] = useState<string | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);

  const parsed = value.trim() ? Number(normalizeNumber(value)) : null;
  const valid = parsed === null || (Number.isFinite(parsed) && parsed >= 0 && parsed <= 10_000);
  const unchanged = parsed === price;

  function save() {
    if (!driverName) {
      setError("حددي السائق أولاً حتى تظهر التكلفة في حسابه.");
      return;
    }
    if (!valid) {
      setError("أدخلي مبلغاً صحيحاً بين 0 و10,000 ريال.");
      return;
    }
    setError(null);
    update.mutate(
      {
        ...(leg === "return" ? { returnPrice: parsed } : { price: parsed }),
        expectedVersion,
      },
      {
        onSuccess: () => successFeedback(),
      },
    );
  }

  return (
    <Card variant="raised">
      <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.md }}>
        <View
          style={{
            width: hitSize.min,
            height: hitSize.min,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: radius.full,
            backgroundColor: colors.brandSoft,
          }}
        >
          <IconSymbol name="car" size={20} color={colors.brand} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ ...type.headline, ...rtlText, color: colors.text }}>
            {leg === "return" ? "تكلفة رحلة العودة" : "تكلفة رحلة الذهاب"}
          </Text>
          <Text style={{ ...type.caption, ...rtlText, color: colors.textSecondary }}>
            تدخلها حنان يدوياً حسب المسافة، ويمكن تعديلها بعد اكتمال الطلب.
          </Text>
        </View>
      </View>

      <View
        style={{
          minHeight: hitSize.control,
          flexDirection: "row-reverse",
          alignItems: "center",
          gap: spacing.sm,
          paddingHorizontal: spacing.md,
          borderWidth: 1,
          borderColor: error ? colors.danger : colors.border,
          borderRadius: radius.md,
          borderCurve: "continuous",
          backgroundColor: colors.surface,
        }}
      >
        <Text style={{ ...type.calloutStrong, color: colors.textSecondary }}>ر.س</Text>
        <TextInput
          testID="order-trip-cost-input"
          accessibilityLabel={`${leg === "return" ? "تكلفة رحلة العودة" : "تكلفة رحلة الذهاب"} بالريال`}
          value={value}
          onChangeText={(next) => {
            setValue(next);
            setError(null);
          }}
          keyboardType="decimal-pad"
          returnKeyType="done"
          placeholder="أدخلي التكلفة"
          placeholderTextColor={colors.textTertiary}
          style={{ flex: 1, ...type.bodyStrong, ...numeric, ...rtlText, color: colors.text }}
        />
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="اختيار تكلفة مشوار حسب الحي"
        accessibilityState={{ expanded: optionsOpen }}
        onPress={() => setOptionsOpen((open) => !open)}
        style={({ pressed }) => ({
          minHeight: hitSize.min,
          flexDirection: "row-reverse",
          alignItems: "center",
          justifyContent: "space-between",
          gap: spacing.sm,
          paddingHorizontal: spacing.md,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.md,
          backgroundColor: colors.surfaceSunken,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Text style={{ ...type.calloutStrong, ...rtlText, color: colors.text }}>
          اختيار تكلفة حسب الحي
        </Text>
        <IconSymbol
          name={optionsOpen ? "chevron.up" : "chevron.down"}
          size={15}
          color={colors.textSecondary}
        />
      </Pressable>

      {optionsOpen ? (
        <View
          accessibilityLabel="خيارات تكلفة المشوار"
          style={{
            gap: spacing.xs,
            padding: spacing.xs,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: radius.md,
            backgroundColor: colors.surface,
          }}
        >
          {tripCostOptions.map((option) => (
            <Pressable
              key={option.area}
              accessibilityRole="button"
              accessibilityLabel={`${option.area}، ${option.price} ريال`}
              onPress={() => {
                setValue(String(option.price));
                setError(null);
                setOptionsOpen(false);
              }}
              style={({ pressed }) => ({
                minHeight: hitSize.min,
                flexDirection: "row-reverse",
                alignItems: "center",
                justifyContent: "space-between",
                paddingHorizontal: spacing.md,
                borderRadius: radius.sm,
                backgroundColor: pressed ? colors.brandSoft : "transparent",
              })}
            >
              <Text style={{ ...type.calloutStrong, ...rtlText, color: colors.text }}>
                {option.area}
              </Text>
              <Text style={{ ...type.calloutStrong, ...numeric, color: colors.brand }}>
                {option.price} ر.س
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <Text selectable style={{ ...type.caption, ...numeric, ...rtlText, color: colors.textTertiary }}>
        {price == null
          ? driverName
            ? `لم تُسجل تكلفة لمشوار ${driverName} بعد.`
            : "حددي السائق قبل تسجيل التكلفة."
          : `المسجل حالياً لـ ${driverName ?? "السائق"}: ${priceFormatter.format(price)}`}
      </Text>

      {error ? <InlineAlert message={error} /> : null}
      {update.error ? <InlineAlert message={update.error.message} /> : null}

      <PrimaryButton
        testID="order-trip-cost-save"
        label={leg === "return" ? "حفظ تكلفة العودة" : "حفظ تكلفة الذهاب"}
        icon="checkmark"
        loading={update.isPending}
        disabled={!driverName || !valid || unchanged}
        onPress={save}
      />
    </Card>
  );
}
