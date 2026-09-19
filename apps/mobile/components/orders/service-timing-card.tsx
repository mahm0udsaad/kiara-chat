import { useMemo } from "react";
import { Text, View } from "react-native";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card, Divider } from "@/components/ui/card";
import { DetailRow, SectionHeader } from "@/components/ui/detail-row";
import { spacing, type, rtlText } from "@/constants/theme";
import { useFieldI18n } from "@/lib/field-i18n";
import { durationLabel, formatters } from "@/lib/format";
import { serviceStartTimingOf } from "@/lib/service-timing";
import { useTheme } from "@/providers/theme-provider";

type Timing = NonNullable<ReturnType<typeof serviceStartTimingOf>>;

/**
 * Follows the field locale: a specialist reads her own language, while the
 * admin app has no provider and falls back to Arabic exactly as before.
 */
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
  const { locale, localeTag, t, duration: localizedDuration, textStyle } = useFieldI18n();
  const dateTime = useMemo(
    () =>
      locale === "ar"
        ? formatters.dateTime
        : new Intl.DateTimeFormat(localeTag, { day: "numeric", month: "long", hour: "numeric", minute: "2-digit" }),
    [locale, localeTag],
  );
  const timing = serviceStartTimingOf(scheduledAt, serviceStartedAt, now);
  if (!timing) return null;

  const duration = locale === "ar" ? durationLabel(timing.minutes) : localizedDuration(timing.minutes);
  const status = timingStatus(timing, t, duration);
  const captionStyle = locale === "ar" ? rtlText : textStyle;

  return (
    <View style={{ gap: spacing.sm }}>
      <SectionHeader title={t("timingTitle")} />
      <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
        <DetailRow
          icon="calendar"
          label={t("timingScheduledAt")}
          value={dateTime.format(new Date(timing.scheduledAt))}
          monospacedValue
        />
        <Divider inset={46} />
        <DetailRow
          icon="play.fill"
          label={t("timingActualStart")}
          value={
            timing.startedAt
              ? dateTime.format(new Date(timing.startedAt))
              : t("timingNotStartedYet")
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
          <Text selectable style={{ ...type.caption, color: colors.textTertiary, ...captionStyle }}>
            {t("timingFootnote")}
          </Text>
        </View>
      </Card>
    </View>
  );
}

function timingStatus(
  state: Timing,
  t: ReturnType<typeof useFieldI18n>["t"],
  duration: string,
): { label: string; tone: BadgeTone } {
  switch (state.state) {
    case "late":
      return { label: t("timingLate", { duration }), tone: "danger" };
    case "early":
      return { label: t("timingEarly", { duration }), tone: "success" };
    case "on_time":
      return { label: t("timingOnTime"), tone: "success" };
    case "waiting":
      return { label: t("timingWaiting", { duration }), tone: "danger" };
    case "upcoming":
      return { label: t("timingUpcoming", { duration }), tone: "neutral" };
  }
}
