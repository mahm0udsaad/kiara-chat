import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { AgentAnalysisView } from "@/components/reports/agent-analysis-view";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Divider } from "@/components/ui/card";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { numeric, radius, rtlText, spacing, type } from "@/constants/theme";
import { relativeTimeLabel } from "@/lib/format";
import { REPORT_LOCALE, reportInteger } from "@/lib/operations-report";
import { useTheme } from "@/providers/theme-provider";
import type { AgentVerdict, SavedAgentReport } from "@/types/api";

/**
 * Saved AI reviews: the latest one open, earlier ones in a collapsed list.
 * A review stays on the screen until the owner runs a new one.
 */

const dayLabel = new Intl.DateTimeFormat(REPORT_LOCALE, { day: "numeric", month: "short" });
const runLabel = new Intl.DateTimeFormat(REPORT_LOCALE, {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Riyadh",
});

const verdictBadge: Record<AgentVerdict, { label: string; tone: BadgeTone }> = {
  excellent: { label: "ممتازة", tone: "success" },
  good: { label: "جيدة", tone: "info" },
  needs_coaching: { label: "تحتاج تدريبًا", tone: "warning" },
  needs_intervention: { label: "تحتاج تدخلًا", tone: "danger" },
};

function periodLabel(report: SavedAgentReport) {
  const from = dayLabel.format(new Date(`${report.from}T12:00:00+03:00`));
  const to = dayLabel.format(new Date(`${report.to}T12:00:00+03:00`));
  return `${report.from === report.to ? from : `${from} – ${to}`} · ${report.startTime}–${report.endTime}`;
}

function ReportMeta({ report }: { report: SavedAgentReport }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 2 }}>
      <Text selectable style={{ ...type.subheadStrong, ...numeric, ...rtlText, color: colors.text }}>
        الفترة: {periodLabel(report)}
      </Text>
      <Text selectable style={{ ...type.caption, ...numeric, ...rtlText, color: colors.textTertiary }}>
        حُلّل {relativeTimeLabel(report.createdAt)} · {runLabel.format(new Date(report.createdAt))}
      </Text>
    </View>
  );
}

export function AgentAnalysisHistory({
  reports,
  isLoading,
  selectedFrom,
  selectedTo,
}: {
  reports: SavedAgentReport[];
  isLoading: boolean;
  selectedFrom: string;
  selectedTo: string;
}) {
  const { colors } = useTheme();
  const [showHistory, setShowHistory] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  if (isLoading && !reports.length) {
    return <ActivityIndicator size="small" color={colors.brand} />;
  }
  if (!reports.length) {
    return (
      <Text style={{ ...type.footnote, ...rtlText, color: colors.textSecondary }}>
        لا يوجد تحليل محفوظ لهذه الموظفة بعد.
      </Text>
    );
  }

  const [latest, ...older] = reports;
  const otherPeriod = latest!.from !== selectedFrom || latest!.to !== selectedTo;

  return (
    <View style={{ gap: spacing.lg }}>
      <View
        style={{
          padding: spacing.md,
          gap: spacing.xs,
          borderRadius: radius.lg,
          backgroundColor: colors.surfaceSunken,
        }}
      >
        <Text style={{ ...type.caption, ...rtlText, color: colors.brand }}>آخر تحليل</Text>
        <ReportMeta report={latest!} />
        {otherPeriod ? (
          <Text style={{ ...type.caption, ...rtlText, color: colors.warning }}>
            يغطي فترة مختلفة عن الفترة المختارة أعلاه. اضغطي «إعادة التحليل» لتحليل الفترة المختارة.
          </Text>
        ) : null}
      </View>

      <AgentAnalysisView analysis={latest!.analysis} />

      {older.length ? (
        <>
          <Divider />
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showHistory }}
            accessibilityLabel={`التحليلات السابقة، ${older.length}`}
            onPress={() => setShowHistory((value) => !value)}
            style={({ pressed }) => ({
              opacity: pressed ? 0.65 : 1,
              minHeight: 44,
              flexDirection: "row-reverse",
              alignItems: "center",
              gap: spacing.sm,
            })}
          >
            <Text style={{ flex: 1, ...type.headline, ...rtlText, color: colors.text }}>
              التحليلات السابقة ({reportInteger.format(older.length)})
            </Text>
            <IconSymbol name={showHistory ? "chevron.up" : "chevron.down"} size={16} color={colors.textSecondary} />
          </Pressable>

          {showHistory
            ? older.map((report) => {
                const open = openId === report.id;
                const verdict = report.analysis.verdict && !report.analysis.aiUnavailable
                  ? verdictBadge[report.analysis.verdict]
                  : null;
                return (
                  <View key={report.id} style={{ gap: spacing.md }}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ expanded: open }}
                      accessibilityLabel={`تحليل ${periodLabel(report)}`}
                      onPress={() => setOpenId(open ? null : report.id)}
                      style={({ pressed }) => ({
                        opacity: pressed ? 0.65 : 1,
                        padding: spacing.md,
                        borderRadius: radius.lg,
                        backgroundColor: colors.surfaceSunken,
                        flexDirection: "row-reverse",
                        alignItems: "center",
                        gap: spacing.sm,
                      })}
                    >
                      <View style={{ flex: 1 }}>
                        <ReportMeta report={report} />
                      </View>
                      {report.analysis.aiUnavailable ? (
                        <Badge label="أرقام فقط" tone="neutral" />
                      ) : (
                        <Text style={{ ...type.headline, ...numeric, color: colors.text }}>
                          {reportInteger.format(report.analysis.score)}
                        </Text>
                      )}
                      {verdict ? <Badge label={verdict.label} tone={verdict.tone} /> : null}
                      <IconSymbol name={open ? "chevron.up" : "chevron.down"} size={16} color={colors.textSecondary} />
                    </Pressable>
                    {open ? <AgentAnalysisView analysis={report.analysis} /> : null}
                  </View>
                );
              })
            : null}
        </>
      ) : null}
    </View>
  );
}
