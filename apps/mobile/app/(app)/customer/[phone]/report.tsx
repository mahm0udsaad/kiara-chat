import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { ScrollView, Text, View } from "react-native";

import { EmptyState, ErrorState, LoadingScreen } from "@/components/screen-state";
import { Badge } from "@/components/ui/badge";
import { Card, Divider } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/detail-row";
import { IconSymbol, type IconName } from "@/components/ui/icon-symbol";
import { radius, rtlText, spacing, type } from "@/constants/theme";
import { formatters } from "@/lib/format";
import { useBootstrap, useConversationAudit } from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";
import type { AuditEntry, AuditPerson, CustodyPeriod } from "@/types/api";

/** Whose desk a period sat on, in one line the owner can read at a glance. */
const START_LABEL: Record<CustodyPeriod["startedBy"], string> = {
  start: "قبل الاستلام",
  claim: "استلمتها بنفسها",
  reassign: "حُوّلت إليها",
  takeover: "سحبتها",
  release: "أُطلقت للطابور",
  bot: "عادت للبوت",
};

const ROLE_LABEL: Record<string, string> = {
  admin: "مديرة",
  agent: "موظفة",
  owner: "المالكة",
  specialist: "أخصائية",
  driver: "سائق",
  system: "النظام",
};

function iconFor(type: string): IconName {
  if (type.startsWith("custody.")) return "person.crop.circle";
  if (type.startsWith("field.")) return "car";
  if (type.startsWith("order.")) return "paperplane.fill";
  if (type.includes("label")) return "slider.horizontal.3";
  if (type.includes("note")) return "doc.text";
  if (type.includes("stage") || type.includes("reminder")) return "clock";
  return "checkmark.circle";
}

function clockLabel(iso: string): string {
  return formatters.dateTime.format(new Date(iso));
}

/** Whole hours and minutes a period lasted; open periods say so. */
function spanLabel(from: string, to: string | null): string {
  const end = to ? Date.parse(to) : Date.now();
  const minutes = Math.max(0, Math.round((end - Date.parse(from)) / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const span =
    hours >= 24
      ? `${Math.floor(hours / 24)} يوم`
      : hours
        ? `${hours} س${rest ? ` و${rest} د` : ""}`
        : `${rest} د`;
  return to ? span : `${span} · ما زالت مفتوحة`;
}

function PersonLine({ person }: { person: AuditPerson | null }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}>
      <IconSymbol
        name={person ? "person.crop.circle" : "sparkles"}
        color={person ? colors.brand : colors.textTertiary}
        size={18}
      />
      <Text style={{ flex: 1, ...type.headline, color: colors.text, ...rtlText }}>
        {person?.name ?? "بدون مسؤولة — البوت أو الطابور"}
      </Text>
      {person ? (
        <Badge label={ROLE_LABEL[person.role] ?? person.role} tone="neutral" />
      ) : null}
    </View>
  );
}

function ActionRow({ entry, holder }: { entry: AuditEntry; holder: AuditPerson | null }) {
  const { colors } = useTheme();
  // Naming the actor on every line would repeat the holder's name down the
  // whole period; it earns its place only when somebody else reached in.
  const foreign = entry.actor && entry.actor.key !== holder?.key ? entry.actor : null;
  return (
    <View style={{ flexDirection: "row-reverse", gap: spacing.sm, paddingVertical: spacing.xs }}>
      <IconSymbol name={iconFor(entry.type)} color={colors.textTertiary} size={16} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...type.subheadStrong, color: colors.text, ...rtlText }}>
          {entry.title}
          {foreign ? ` · ${foreign.name}` : ""}
        </Text>
        {entry.detail ? (
          <Text style={{ ...type.footnote, color: colors.textSecondary, ...rtlText }}>
            {entry.detail}
          </Text>
        ) : null}
      </View>
      <Text
        style={{
          ...type.caption,
          color: colors.textTertiary,
          fontVariant: ["tabular-nums"],
        }}
      >
        {clockLabel(entry.at)}
      </Text>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: "center", gap: 2 }}>
      <Text
        style={{
          ...type.title3,
          color: colors.text,
          fontVariant: ["tabular-nums"],
        }}
      >
        {value}
      </Text>
      <Text style={{ ...type.caption, color: colors.textSecondary, ...rtlText }}>{label}</Text>
    </View>
  );
}

export default function CustomerResponsibilityReport() {
  const { colors } = useTheme();
  const params = useLocalSearchParams<{
    phone: string | string[];
    conversationId?: string | string[];
  }>();
  const conversationId = useMemo(() => {
    const raw = params.conversationId;
    return Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "");
  }, [params.conversationId]);

  const bootstrap = useBootstrap();
  const isAdmin = bootstrap.data?.session.role === "admin";
  const report = useConversationAudit(conversationId, Boolean(isAdmin));

  if (!conversationId) {
    return (
      <EmptyState
        icon="person.crop.circle"
        title="لا توجد محادثة لهذه العميلة بعد"
        detail="سجل المسؤولية يُبنى من محادثة واتساب، ولا توجد واحدة لهذا الرقم."
      />
    );
  }
  if (bootstrap.isLoading || report.isLoading) {
    return <LoadingScreen label="جارٍ تجهيز سجل المسؤولية…" />;
  }
  if (!isAdmin) {
    return (
      <EmptyState
        icon="person.crop.circle"
        title="سجل المسؤولية للإدارة فقط"
        detail="اطلبي من المالكة فتحه من حسابها."
      />
    );
  }
  if (report.isError || !report.data) {
    return (
      <ErrorState
        message={report.error?.message ?? "تعذّر تحميل سجل المسؤولية"}
        onRetry={() => void report.refetch()}
      />
    );
  }

  const data = report.data;
  // Newest first: the owner opens this to ask "who has it now", and reads
  // backwards from there.
  const periods = [...data.periods].reverse();

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        padding: spacing.lg,
        gap: spacing.lg,
        paddingBottom: spacing["3xl"],
      }}
    >
      <Card>
        <Text selectable style={{ ...type.title3, color: colors.text, ...rtlText }}>
          {data.customerName || data.customerPhone}
        </Text>
        <Text style={{ ...type.footnote, color: colors.textSecondary, ...rtlText }}>
          {data.currentHolder
            ? `المسؤولة الآن: ${data.currentHolder.name}`
            : "المحادثة غير مُسندة حاليًا"}
        </Text>
        <Divider />
        <View style={{ flexDirection: "row-reverse" }}>
          <Stat label="رسائل واردة" value={data.totals.inbound} />
          <Stat label="ردود الفريق" value={data.totals.outbound} />
          <Stat label="إجراءات" value={data.totals.actions} />
          <Stat label="تسليمات" value={data.totals.handovers} />
        </View>
      </Card>

      {data.messagesByPerson.length ? (
        <View style={{ gap: spacing.sm }}>
          <SectionHeader title="ردود كل موظفة" />
          <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
            {data.messagesByPerson.map((row, index) => (
              <View key={row.person.key}>
                {index ? <Divider /> : null}
                <View
                  style={{
                    flexDirection: "row-reverse",
                    alignItems: "center",
                    gap: spacing.sm,
                    paddingVertical: spacing.md,
                  }}
                >
                  <Text style={{ flex: 1, ...type.body, color: colors.text, ...rtlText }}>
                    {row.person.name}
                  </Text>
                  <Text
                    style={{
                      ...type.bodyStrong,
                      color: colors.brand,
                      fontVariant: ["tabular-nums"],
                    }}
                  >
                    {row.messages}
                  </Text>
                </View>
              </View>
            ))}
          </Card>
        </View>
      ) : null}

      <View style={{ gap: spacing.sm }}>
        <SectionHeader title="فترات المسؤولية" />
        {periods.length === 0 ? (
          <EmptyState
            icon="person.crop.circle"
            title="لم تُستلم هذه المحادثة بعد"
            detail="لا توجد فترات مسؤولية مسجلة على هذه المحادثة."
          />
        ) : null}
        {periods.map((period) => (
          <Card key={`${period.from}-${period.holder?.key ?? "none"}`}>
            <PersonLine person={period.holder} />
            <View
              style={{
                flexDirection: "row-reverse",
                alignItems: "center",
                flexWrap: "wrap",
                gap: spacing.xs,
              }}
            >
              <Text style={{ ...type.footnote, color: colors.textSecondary, ...rtlText }}>
                {START_LABEL[period.startedBy]}
                {period.startedByActor ? ` بواسطة ${period.startedByActor.name}` : ""}
              </Text>
            </View>
            <Text
              style={{
                ...type.footnote,
                color: colors.textTertiary,
                ...rtlText,
              }}
            >
              {clockLabel(period.from)} — {period.to ? clockLabel(period.to) : "حتى الآن"} ·{" "}
              {spanLabel(period.from, period.to)}
            </Text>

            <View
              style={{
                flexDirection: "row-reverse",
                gap: spacing.sm,
                paddingVertical: spacing.xs,
              }}
            >
              <Badge label={`وارد ${period.inboundMessages}`} tone="neutral" />
              <Badge label={`ردود ${period.outboundMessages}`} tone="brand" />
            </View>

            {period.actions.length ? (
              <View
                style={{
                  gap: 2,
                  borderRadius: radius.md,
                  borderCurve: "continuous",
                  backgroundColor: colors.surfaceSunken,
                  padding: spacing.sm,
                }}
              >
                {period.actions.map((entry, index) => (
                  <ActionRow
                    key={`${entry.at}-${entry.type}-${index}`}
                    entry={entry}
                    holder={period.holder}
                  />
                ))}
              </View>
            ) : (
              <Text style={{ ...type.footnote, color: colors.textTertiary, ...rtlText }}>
                لا إجراءات مسجلة في هذه الفترة.
              </Text>
            )}
          </Card>
        ))}
      </View>
    </ScrollView>
  );
}
