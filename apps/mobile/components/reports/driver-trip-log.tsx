import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { numeric, rtlText, spacing, type } from "@/constants/theme";
import {
  driverStepVerdict,
  REPORT_LOCALE,
  type OperationsVisit,
} from "@/lib/operations-report";
import { useTheme } from "@/providers/theme-provider";
import type { DriverStep } from "@/types/api";

const tripTime = new Intl.DateTimeFormat(REPORT_LOCALE, {
  timeZone: "Asia/Riyadh",
  hour: "numeric",
  minute: "2-digit",
});

/**
 * The driver's arrival at the client against the booking time: when it was,
 * when he tapped it, and what that came to.
 */
function StepLine({ title, dueLabel, step }: { title: string; dueLabel: string; step: DriverStep }) {
  const { colors } = useTheme();
  const verdict = driverStepVerdict(step);
  return (
    <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...type.footnote, ...rtlText, color: colors.text }}>{title}</Text>
        <Text selectable style={{ ...type.caption, ...numeric, ...rtlText, color: colors.textSecondary }}>
          {dueLabel} {tripTime.format(new Date(step.dueAt))}
          {step.at ? ` · ضغط ${tripTime.format(new Date(step.at))}` : " · لم يضغط"}
        </Text>
      </View>
      <Badge label={verdict.label} tone={verdict.tone} />
    </View>
  );
}

function TripRow({ visit }: { visit: OperationsVisit }) {
  const { colors } = useTheme();
  const customer = visit.customerName || visit.customerPhone;
  const steps = visit.driverSteps;
  const row = (
    <View style={{ paddingVertical: spacing.md, gap: spacing.sm }}>
      <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text selectable numberOfLines={1} style={{ ...type.bodyStrong, ...rtlText, color: colors.text }}>
            {customer}
          </Text>
          <Text selectable style={{ ...type.caption, ...numeric, ...rtlText, color: colors.brand }}>
            موعد العميلة {tripTime.format(new Date(visit.arrivalAt))}
            {visit.driverLeg === "return" ? " · مشوار عودة" : ""}
          </Text>
        </View>
        <Badge
          label={visit.completed ? "مكتمل" : "لم يكتمل"}
          tone={visit.completed ? "success" : "neutral"}
          icon={visit.completed ? "checkmark.circle" : "clock"}
        />
      </View>
      {steps ? (
        <>
          <StepLine title="وصل للعميلة" dueLabel="وقت الحجز" step={steps.client} />
        </>
      ) : null}
    </View>
  );
  if (!visit.orderId) return row;
  return (
    <Link href={{ pathname: "/reports/order/[id]", params: { id: visit.orderId } }} asChild>
      <Pressable
        testID={`driver-trip-${visit.orderId}`}
        accessibilityRole="button"
        accessibilityLabel={`فتح تفاصيل مشوار ${customer}`}
        style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
      >
        {row}
      </Pressable>
    </Link>
  );
}

/**
 * A driver's trips for one day as a plain log: which he had, which he
 * finished, and whether he reached the client at the booking time.
 */
export function DriverTripLog({ visits }: { visits: OperationsVisit[] }) {
  const { colors } = useTheme();
  return (
    <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
      {visits.map((visit, index) => (
        <View key={visit.key}>
          {index ? (
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />
          ) : null}
          <TripRow visit={visit} />
        </View>
      ))}
    </Card>
  );
}
