import { Link } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { hitSize, numeric, radius, rtlText, spacing, type } from "@/constants/theme";
import { durationLabel } from "@/lib/format";
import { REPORT_LOCALE, reportInteger, type OperationsVisit } from "@/lib/operations-report";
import { useTheme } from "@/providers/theme-provider";

const visitTime = new Intl.DateTimeFormat(REPORT_LOCALE, {
  timeZone: "Asia/Riyadh",
  hour: "numeric",
  minute: "2-digit",
});

function VisitContent({ visit }: { visit: OperationsVisit }) {
  const { colors } = useTheme();
  const customer = visit.customerName || visit.customerPhone;
  return (
    <Card
      padded={false}
      style={{ borderColor: visit.completed ? colors.success : colors.border }}
    >
      <View style={{ padding: spacing.lg, gap: spacing.md }}>
        <View style={{ flexDirection: "row-reverse", alignItems: "flex-start", gap: spacing.md }}>
          <View
            style={{
              width: hitSize.min,
              height: hitSize.min,
              borderRadius: radius.full,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: visit.completed ? colors.successSoft : colors.brandSoft,
            }}
          >
            <IconSymbol
              name={visit.completed ? "checkmark.circle" : "calendar"}
              size={20}
              color={visit.completed ? colors.onSuccessSoft : colors.onBrandSoft}
            />
          </View>
          <View style={{ flex: 1, gap: spacing.xs }}>
            <Text selectable style={{ ...type.headline, ...rtlText, color: colors.text }}>
              {customer}
            </Text>
            <Text selectable style={{ ...type.footnote, ...numeric, ...rtlText, color: colors.brand }}>
              {visitTime.format(new Date(visit.arrivalAt))}–{visitTime.format(new Date(visit.endsAt))}
              {` · ${durationLabel(visit.spanMinutes)}`}
            </Text>
          </View>
        </View>

        <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: spacing.sm }}>
          <Badge
            label={visit.completed ? "مكتملة" : "مجدولة"}
            tone={visit.completed ? "success" : "brand"}
            icon={visit.completed ? "checkmark.circle" : "clock"}
          />
          <Badge label={visit.sourceLabel} tone="neutral" />
          {visit.serviceCount > 1 ? (
            <Badge label={`${reportInteger.format(visit.serviceCount)} خدمات في زيارة واحدة`} tone="info" />
          ) : null}
        </View>

        <View
          accessibilityLabel={`خدمات الزيارة، ${visit.serviceCount}`}
          style={{ gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceSunken }}
        >
          {visit.services.map((service) => (
            <View key={service.name} style={{ flexDirection: "row-reverse", alignItems: "flex-start", gap: spacing.sm }}>
              <View
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: radius.full,
                  backgroundColor: colors.brand,
                  marginTop: spacing.sm,
                }}
              />
              <Text selectable style={{ ...type.subhead, ...rtlText, flex: 1, color: colors.text }}>
                {service.name}
                {service.count > 1 ? ` ×${reportInteger.format(service.count)}` : ""}
              </Text>
              <Text selectable style={{ ...type.caption, ...numeric, color: colors.textTertiary }}>
                {durationLabel(service.durationMinutes)}
              </Text>
            </View>
          ))}
        </View>
      </View>

      <View
        style={{
          minHeight: hitSize.min,
          paddingHorizontal: spacing.lg,
          flexDirection: "row-reverse",
          alignItems: "center",
          justifyContent: "space-between",
          backgroundColor: visit.orderId ? colors.brandSoft : colors.surfaceSunken,
        }}
      >
        <Text style={{ ...type.footnote, ...rtlText, color: visit.orderId ? colors.onBrandSoft : colors.textTertiary }}>
          {visit.orderId ? "فتح تفاصيل الطلب" : "حجز فقط — لا يوجد طلب تشغيلي"}
        </Text>
        {visit.orderId ? <IconSymbol name="chevron.left" size={18} color={colors.onBrandSoft} /> : null}
      </View>
    </Card>
  );
}

export function VisitCard({ visit }: { visit: OperationsVisit }) {
  if (!visit.orderId) return <VisitContent visit={visit} />;
  return (
    <Link href={{ pathname: "/orders/[id]", params: { id: visit.orderId } }} asChild>
      <Pressable
        testID={`report-order-${visit.orderId}`}
        accessibilityRole="button"
        accessibilityLabel={`فتح تفاصيل طلب ${visit.customerName || visit.customerPhone}`}
        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
      >
        <VisitContent visit={visit} />
      </Pressable>
    </Link>
  );
}
