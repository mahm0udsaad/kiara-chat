import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { labelColor } from "@/components/conversation-actions-button";
import { ReportGroup, RowDivider } from "@/components/reports/report-rows";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { hitSize, numeric, radius, rtlText, spacing, type } from "@/constants/theme";
import { reportInteger } from "@/lib/operations-report";
import { useTheme } from "@/providers/theme-provider";
import type { LabelTally } from "@/types/api";

/**
 * How many times each followed label was ticked in the period. Tapping a
 * label opens, in place, the employees who ticked it and how many times.
 */
export function LabelTalliesCard({ tallies }: { tallies: LabelTally[] }) {
  const { colors } = useTheme();
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <ReportGroup title="التصنيفات" description="كم مرة وُضع كل تصنيف على محادثة خلال الفترة. اضغطي على التصنيف لعرض الموظفات.">
      {tallies.map((tally, index) => {
        const open = openId === tally.id;
        return (
          <View key={tally.id}>
            {index ? <RowDivider /> : null}
            <Pressable
              testID={`customer-service-label-${tally.id}`}
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
              accessibilityLabel={`${tally.name}، ${reportInteger.format(tally.total)}`}
              accessibilityHint={open ? "يخفي الموظفات" : "يعرض كم مرة وضعته كل موظفة"}
              onPress={() => setOpenId(open ? null : tally.id)}
              style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
            >
              <View
                style={{
                  minHeight: hitSize.comfortable,
                  paddingHorizontal: spacing.lg,
                  paddingVertical: spacing.sm,
                  flexDirection: "row-reverse",
                  alignItems: "center",
                  gap: spacing.md,
                }}
              >
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: radius.full,
                    backgroundColor: labelColor(tally.color, colors),
                  }}
                />
                <Text style={{ ...type.callout, ...rtlText, flex: 1, color: colors.text }}>{tally.name}</Text>
                <Text selectable style={{ ...type.calloutStrong, ...numeric, color: colors.brand }}>
                  {reportInteger.format(tally.total)}
                </Text>
                <IconSymbol name={open ? "chevron.up" : "chevron.down"} size={15} color={colors.textTertiary} />
              </View>
            </Pressable>
            {open ? (
              <View
                style={{
                  marginHorizontal: spacing.lg,
                  marginBottom: spacing.sm,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.xs,
                  borderRadius: radius.md,
                  backgroundColor: colors.surfaceSunken,
                }}
              >
                {tally.employees.length ? (
                  tally.employees.map((employee) => (
                    <View
                      key={employee.memberId ?? employee.name}
                      style={{
                        minHeight: 36,
                        flexDirection: "row-reverse",
                        alignItems: "center",
                        gap: spacing.md,
                      }}
                    >
                      <Text selectable style={{ ...type.subhead, ...rtlText, flex: 1, color: colors.text }}>
                        {employee.name}
                      </Text>
                      <Text selectable style={{ ...type.subheadStrong, ...numeric, color: colors.text }}>
                        {reportInteger.format(employee.count)}
                      </Text>
                    </View>
                  ))
                ) : (
                  <Text style={{ ...type.footnote, ...rtlText, paddingVertical: spacing.sm, color: colors.textSecondary }}>
                    لم يُوضع هذا التصنيف خلال الفترة.
                  </Text>
                )}
              </View>
            ) : null}
          </View>
        );
      })}
    </ReportGroup>
  );
}
