import { useState } from "react";
import { Text, TextInput, View } from "react-native";

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
}: {
  orderId: string;
  expectedVersion: number;
  price: number | null;
  driverName: string | null;
}) {
  const { colors } = useTheme();
  const update = useUpdateOrder(orderId);
  const [value, setValue] = useState(price == null ? "" : String(price));
  const [error, setError] = useState<string | null>(null);

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
      { price: parsed, expectedVersion },
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
          <Text style={{ ...type.headline, ...rtlText, color: colors.text }}>تكلفة المشوار</Text>
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
          accessibilityLabel="تكلفة المشوار بالريال"
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
        label="حفظ تكلفة المشوار"
        icon="checkmark"
        loading={update.isPending}
        disabled={!driverName || !valid || unchanged}
        onPress={save}
      />
    </Card>
  );
}
