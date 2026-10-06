import { useState } from "react";
import { Text, View } from "react-native";

import { DistrictPicker } from "@/components/orders/district-picker";
import { PrimaryButton } from "@/components/primary-button";
import { InlineAlert } from "@/components/screen-state";
import { Card } from "@/components/ui/card";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { hitSize, numeric, radius, rtlText, spacing, type } from "@/constants/theme";
import { successFeedback } from "@/lib/haptics";
import { useDispatchOptions, useUpdateOrder } from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";
import type { OrderSummary } from "@/types/api";

const priceFormatter = new Intl.NumberFormat("ar-SA", {
  style: "currency",
  currency: "SAR",
  maximumFractionDigits: 2,
});

/**
 * The order's district, and the trip cost that follows from it.
 *
 * Replaces the hand-typed fare: any employee picks the district (now or long
 * after the visit), and the server copies that district's fare onto the order.
 * "بدون حي" is always allowed and leaves the trip with no cost.
 */
export function TripDistrictCard({
  order,
  canViewPrice,
}: {
  order: OrderSummary;
  canViewPrice: boolean;
}) {
  const { colors } = useTheme();
  const options = useDispatchOptions();
  const update = useUpdateOrder(order.id);
  const saved = order.district_id ?? null;
  const [districtId, setDistrictId] = useState<string | null>(saved);
  const [open, setOpen] = useState(false);

  const districts = options.data?.districts ?? [];
  const changed = districtId !== saved;

  const costLine = () => {
    if (order.price == null) {
      return order.district_id
        ? "لا توجد تكلفة مسجلة لهذا المشوار."
        : "بدون حي — لا تُسجل تكلفة للمشوار حتى يُختار الحي.";
    }
    const outbound = `${order.driver_name ? `مشوار ${order.driver_name}` : "المشوار"}: ${priceFormatter.format(order.price)}`;
    return order.return_price != null
      ? `${outbound} · العودة${order.return_driver_name ? ` مع ${order.return_driver_name}` : ""}: ${priceFormatter.format(order.return_price)}`
      : outbound;
  };

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
          <IconSymbol name="mappin.and.ellipse" size={20} color={colors.brand} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ ...type.headline, ...rtlText, color: colors.text }}>
            {order.district_name ?? "لم يُحدد الحي"}
          </Text>
          <Text style={{ ...type.caption, ...rtlText, color: colors.textSecondary }}>
            تكلفة المشوار تُحسب تلقائيًا من الحي.
          </Text>
        </View>
      </View>

      {canViewPrice ? (
        <Text selectable style={{ ...type.footnote, ...numeric, ...rtlText, color: colors.textSecondary }}>
          {costLine()}
        </Text>
      ) : null}

      {open ? (
        <>
          {options.isError ? (
            <InlineAlert message={options.error?.message ?? "تعذر تحميل الأحياء"} />
          ) : (
            <DistrictPicker
              label="الحي"
              districts={districts}
              value={districtId}
              currentName={order.district_name}
              onChange={setDistrictId}
              disabled={update.isPending}
            />
          )}
          {update.error ? <InlineAlert message={update.error.message} /> : null}
          <PrimaryButton
            testID="order-district-save"
            label={districtId ? "حفظ الحي" : "حفظ بدون حي"}
            icon="checkmark"
            loading={update.isPending}
            disabled={!changed}
            onPress={() =>
              update.mutate(
                { districtId, expectedVersion: order.version },
                {
                  onSuccess: () => {
                    successFeedback();
                    setOpen(false);
                  },
                },
              )
            }
          />
          <PrimaryButton
            label="إلغاء"
            variant="plain"
            disabled={update.isPending}
            onPress={() => {
              setDistrictId(saved);
              setOpen(false);
              update.reset();
            }}
          />
        </>
      ) : (
        <PrimaryButton
          testID="order-district-change"
          label={order.district_id ? "تغيير الحي" : "اختيار الحي"}
          icon="pencil"
          variant="tinted"
          silent
          onPress={() => setOpen(true)}
        />
      )}
    </Card>
  );
}
