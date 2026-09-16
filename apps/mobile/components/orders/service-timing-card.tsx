import { Text, View } from "react-native";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card, Divider } from "@/components/ui/card";
import { DetailRow, SectionHeader } from "@/components/ui/detail-row";
import { spacing, type, rtlText } from "@/constants/theme";
import { durationLabel, formatters } from "@/lib/format";
import { serviceStartTimingOf } from "@/lib/service-timing";
import { useTheme } from "@/providers/theme-provider";

function timingStatus(state: NonNullable<ReturnType<typeof serviceStartTimingOf>>) {
  const duration = durationLabel(state.minutes);
  switch (state.state) {
    case "late":
      return { label: `بدأت متأخرة بـ ${duration}`, tone: "danger" as BadgeTone };
    case "early":
      return { label: `بدأت قبل الموعد بـ ${duration}`, tone: "success" as BadgeTone };
    case "on_time":
      return { label: "بدأت في الموعد", tone: "success" as BadgeTone };
    case "waiting":
      return { label: `متأخرة حتى الآن بـ ${duration}`, tone: "danger" as BadgeTone };
    case "upcoming":
      return { label: `متبقي على الموعد ${duration}`, tone: "neutral" as BadgeTone };
  }
}

export function ServiceTimingCard({
  scheduledAt,
  serviceStartedAt,
  now,
}: {
  scheduledAt: string;
  serviceStartedAt: string | null | undefined;
  now?: Date;
}) {
  const { colors } = useTheme();
  const timing = serviceStartTimingOf(scheduledAt, serviceStartedAt, now);
  if (!timing) return null;
  const status = timingStatus(timing);

  return (
    <View style={{ gap: spacing.sm }}>
      <SectionHeader title="الالتزام بموعد الخدمة" />
      <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
        <DetailRow
          icon="calendar"
          label="موعد بدء الخدمة"
          value={formatters.dateTime.format(new Date(timing.scheduledAt))}
          monospacedValue
        />
        <Divider inset={46} />
        <DetailRow
          icon="play.fill"
          label="بدء الخدمة الفعلي"
          value={
            timing.startedAt
              ? formatters.dateTime.format(new Date(timing.startedAt))
              : "لم تضغط الأخصائية بدء الخدمة بعد"
          }
          monospacedValue={Boolean(timing.startedAt)}
          tone={timing.startedAt ? "default" : "muted"}
        />
        <Divider inset={46} />
        <View style={{ paddingVertical: spacing.md, gap: spacing.sm }}>
          <Badge
            label={status.label}
            tone={status.tone}
            icon={timing.state === "late" || timing.state === "waiting" ? "exclamationmark.circle" : "clock"}
          />
          <Text selectable style={{ ...type.caption, color: colors.textTertiary, ...rtlText }}>
            يتم تثبيت الحساب من وقت ضغطة الأخصائية على «بدء الخدمة».
          </Text>
        </View>
      </Card>
    </View>
  );
}

