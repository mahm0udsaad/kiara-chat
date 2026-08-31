import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { ScrollView, Text, View } from "react-native";

import { EmptyState, ErrorState, LoadingScreen } from "@/components/screen-state";
import { Badge } from "@/components/ui/badge";
import { Card, Divider } from "@/components/ui/card";
import { IconSymbol, type IconName } from "@/components/ui/icon-symbol";
import { radius, rtlText, spacing, type } from "@/constants/theme";
import { formatters } from "@/lib/format";
import { useBootstrap, useOrderAudit } from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";
import type { AuditEntry } from "@/types/api";

const ROLE_LABEL: Record<string, string> = {
  admin: "مديرة",
  agent: "موظفة",
  owner: "المالكة",
  specialist: "أخصائية",
  driver: "سائق",
  system: "النظام",
};

function iconFor(type: string): IconName {
  if (type === "order.created") return "plus";
  if (type === "order.updated") return "pencil";
  if (type.startsWith("order.dispatch")) return "paperplane.fill";
  if (type === "field.reminder_sent") return "bell";
  if (type.startsWith("field.")) return "car";
  return "checkmark.circle";
}

/**
 * One row of the order's history. The actor is the point of the screen, so it
 * is never folded away — an action nobody is named for is the thing the owner
 * opened this to find.
 */
function Entry({ entry, last }: { entry: AuditEntry; last: boolean }) {
  const { colors } = useTheme();
  const system = !entry.actor || entry.actor.role === "system";
  return (
    <View style={{ flexDirection: "row-reverse", gap: spacing.md }}>
      <View style={{ alignItems: "center", width: 28 }}>
        <View
          style={{
            width: 28,
            height: 28,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: radius.full,
            backgroundColor: system ? colors.surfaceSunken : colors.brandSoft,
          }}
        >
          <IconSymbol
            name={iconFor(entry.type)}
            size={15}
            color={system ? colors.textTertiary : colors.onBrandSoft}
          />
        </View>
        {last ? null : (
          <View style={{ flex: 1, width: 1.5, backgroundColor: colors.border }} />
        )}
      </View>

      <View style={{ flex: 1, paddingBottom: last ? 0 : spacing.lg, gap: 3 }}>
        <Text style={{ ...type.subheadStrong, color: colors.text, ...rtlText }}>
          {entry.title}
        </Text>
        <Text style={{ ...type.footnote, color: colors.textSecondary, ...rtlText }}>
          {entry.actor ? entry.actor.name : "النظام"}
          {entry.actor && ROLE_LABEL[entry.actor.role]
            ? ` · ${ROLE_LABEL[entry.actor.role]}`
            : ""}
        </Text>
        {entry.detail ? (
          <Text style={{ ...type.footnote, color: colors.textTertiary, ...rtlText }}>
            {entry.detail}
          </Text>
        ) : null}
        <Text
          style={{
            ...type.caption,
            color: colors.textTertiary,
            fontVariant: ["tabular-nums"],
            ...rtlText,
          }}
        >
          {formatters.fullDateTime.format(new Date(entry.at))}
        </Text>
      </View>
    </View>
  );
}

export default function OrderActivityScreen() {
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = useMemo(
    () => (Array.isArray(params.id) ? (params.id[0] ?? "") : (params.id ?? "")),
    [params.id],
  );

  const bootstrap = useBootstrap();
  const isAdmin = bootstrap.data?.session.role === "admin";
  const log = useOrderAudit(id, Boolean(isAdmin));

  if (bootstrap.isLoading || log.isLoading) {
    return <LoadingScreen label="جارٍ تحميل سجل الطلب…" />;
  }
  if (!isAdmin) {
    return (
      <EmptyState
        icon="lock"
        title="سجل الطلب للإدارة فقط"
        detail="اطلبي من المالكة فتحه من حسابها."
      />
    );
  }
  if (log.isError || !log.data) {
    return (
      <ErrorState
        message={log.error?.message ?? "تعذّر تحميل سجل الطلب"}
        onRetry={() => void log.refetch()}
      />
    );
  }

  const data = log.data;

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
        <Text selectable style={{ ...type.headline, color: colors.text, ...rtlText }}>
          {data.customerName || data.customerPhone}
        </Text>
        <Text style={{ ...type.footnote, color: colors.textSecondary, ...rtlText }}>
          موعد الوصول: {formatters.fullDateTime.format(new Date(data.arrivalAt))}
        </Text>
        <Divider />
        <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}>
          <Text style={{ flex: 1, ...type.subhead, color: colors.textSecondary, ...rtlText }}>
            أنشأت الطلب
          </Text>
          <Badge
            label={data.createdBy?.name ?? "غير معروف"}
            tone={data.createdBy ? "brand" : "neutral"}
          />
        </View>
      </Card>

      {data.entries.length === 0 ? (
        <EmptyState
          icon="clock"
          title="لا توجد إجراءات مسجلة"
          detail="لم يُسجَّل أي إجراء على هذا الطلب بعد."
        />
      ) : (
        <Card>
          {data.entries.map((entry, index) => (
            <Entry
              key={`${entry.at}-${entry.type}-${index}`}
              entry={entry}
              last={index === data.entries.length - 1}
            />
          ))}
        </Card>
      )}
    </ScrollView>
  );
}
