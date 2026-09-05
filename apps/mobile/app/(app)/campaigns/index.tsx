import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { NewCampaignSheet } from "@/components/campaigns/new-campaign-sheet";
import { NewTemplateSheet } from "@/components/campaigns/new-template-sheet";
import { EmptyState, ErrorState, LoadingScreen } from "@/components/screen-state";
import { PrimaryButton } from "@/components/primary-button";
import { radius, rtlText, spacing, type } from "@/constants/theme";
import { tapFeedback } from "@/lib/haptics";
import { useCampaignTemplates, useCampaigns, useSetCampaignStatus } from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";
import type { Campaign, CampaignTemplate } from "@/types/api";

const STATUS_AR: Record<string, { label: string; tone: "good" | "warn" | "bad" | "muted" }> = {
  approved: { label: "معتمد", tone: "good" },
  received: { label: "قيد المراجعة", tone: "warn" },
  pending: { label: "قيد المراجعة", tone: "warn" },
  rejected: { label: "مرفوض", tone: "bad" },
  unsubmitted: { label: "غير مُرسل", tone: "muted" },
  active: { label: "يعمل", tone: "good" },
  paused: { label: "متوقف", tone: "warn" },
  done: { label: "مكتمل", tone: "muted" },
};

export default function CampaignsScreen() {
  const { colors } = useTheme();
  const [tab, setTab] = useState<"campaigns" | "templates">("campaigns");
  const [newTemplate, setNewTemplate] = useState(false);
  const [newCampaign, setNewCampaign] = useState(false);

  const templates = useCampaignTemplates();
  const campaigns = useCampaigns();
  const setStatus = useSetCampaignStatus();

  const toneColor = (tone: string) =>
    tone === "good" ? colors.success : tone === "bad" ? colors.danger : tone === "warn" ? colors.warning : colors.textTertiary;

  if (templates.isLoading && campaigns.isLoading) return <LoadingScreen label="جارٍ التحميل…" />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Toggle */}
      <View style={{ flexDirection: "row-reverse", gap: spacing.sm, padding: spacing.lg }}>
        {(["campaigns", "templates"] as const).map((t) => (
          <Pressable
            key={t}
            onPress={() => { tapFeedback(); setTab(t); }}
            style={{
              flex: 1,
              alignItems: "center",
              paddingVertical: spacing.md,
              borderRadius: radius.lg,
              backgroundColor: tab === t ? colors.brand : colors.surface,
              borderWidth: 1,
              borderColor: tab === t ? colors.brand : colors.border,
            }}
          >
            <Text style={{ ...type.bodyStrong, color: tab === t ? "#fff" : colors.text }}>
              {t === "campaigns" ? "الحملات" : "القوالب"}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: 0, gap: spacing.sm }}>
        {tab === "campaigns" ? (
          <>
            <PrimaryButton label="استهداف جديد" icon="plus" onPress={() => setNewCampaign(true)} />
            {campaigns.isError ? (
              <ErrorState title="تعذر التحميل" message={campaigns.error.message} onRetry={() => void campaigns.refetch()} />
            ) : !campaigns.data?.campaigns.length ? (
              <EmptyState icon="paperplane.fill" title="لا توجد حملات بعد" detail="ابدئي استهدافًا لإرسال قالب معتمد لفئة عملاء." />
            ) : (
              campaigns.data.campaigns.map((c) => (
                <CampaignCard key={c.id} c={c} colors={colors} toneColor={toneColor}
                  onToggle={() => setStatus.mutate({ id: c.id, status: c.status === "active" ? "paused" : "active" })}
                  busy={setStatus.isPending}
                />
              ))
            )}
          </>
        ) : (
          <>
            <PrimaryButton label="قالب جديد" icon="plus" onPress={() => setNewTemplate(true)} />
            {templates.data?.configured === false ? (
              <EmptyState icon="exclamationmark.triangle" title="واتساب الأعمال غير مُهيّأ" detail="لا يمكن إنشاء القوالب حتى تُضبط بيانات Twilio." />
            ) : !templates.data?.templates.length ? (
              <EmptyState icon="doc.text" title="لا توجد قوالب" detail="أنشئي قالبًا وأرسليه للمراجعة." />
            ) : (
              templates.data.templates.map((t) => (
                <TemplateCard key={t.sid} t={t} colors={colors} toneColor={toneColor} />
              ))
            )}
          </>
        )}
      </ScrollView>

      <NewTemplateSheet open={newTemplate} onClose={() => setNewTemplate(false)} />
      <NewCampaignSheet
        open={newCampaign}
        templates={templates.data?.templates ?? []}
        segments={campaigns.data?.segments ?? []}
        segmentCounts={campaigns.data?.segmentCounts ?? { all: 0, week: 0, month: 0, upcoming: 0, dormant: 0 }}
        onClose={() => setNewCampaign(false)}
      />
    </View>
  );
}

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <View style={{ paddingHorizontal: spacing.md, paddingVertical: 2, borderRadius: radius.full, backgroundColor: `${color}22` }}>
      <Text style={{ ...type.caption, color }}>{label}</Text>
    </View>
  );
}

function CampaignCard({
  c, colors, toneColor, onToggle, busy,
}: {
  c: Campaign; colors: ReturnType<typeof useTheme>["colors"]; toneColor: (t: string) => string;
  onToggle: () => void; busy: boolean;
}) {
  const st = STATUS_AR[c.status] ?? { label: c.status, tone: "muted" as const };
  const pct = c.total ? Math.round((c.sent / c.total) * 100) : 0;
  return (
    <View style={{ padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.sm }}>
      <View style={{ flexDirection: "row-reverse", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ ...type.bodyStrong, color: colors.text, ...rtlText }}>{c.templateName}</Text>
        <Pill label={st.label} color={toneColor(st.tone)} />
      </View>
      <View style={{ height: 6, borderRadius: radius.full, backgroundColor: colors.surfaceSunken, overflow: "hidden" }}>
        <View style={{ height: "100%", width: `${pct}%`, backgroundColor: colors.success }} />
      </View>
      <Text style={{ ...type.caption, color: colors.textSecondary, ...rtlText }}>
        {c.sent} / {c.total} ({pct}%){c.remaining > 0 ? ` — المتبقّي ${c.remaining}` : ""}
      </Text>
      {c.status !== "done" ? (
        <Pressable onPress={() => { tapFeedback(); onToggle(); }} disabled={busy} style={{ alignSelf: "flex-start" }}>
          <Text style={{ ...type.caption, color: colors.brand }}>
            {c.status === "active" ? "إيقاف مؤقت" : "استئناف"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function TemplateCard({
  t, colors, toneColor,
}: { t: CampaignTemplate; colors: ReturnType<typeof useTheme>["colors"]; toneColor: (t: string) => string }) {
  const st = STATUS_AR[t.status] ?? { label: t.status, tone: "muted" as const };
  return (
    <View style={{ padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: 6 }}>
      <View style={{ flexDirection: "row-reverse", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ ...type.bodyStrong, color: colors.text, ...rtlText }}>{t.name}</Text>
        <Pill label={st.label} color={toneColor(st.tone)} />
      </View>
      {t.body ? (
        <Text numberOfLines={3} style={{ ...type.caption, color: colors.textSecondary, ...rtlText }}>{t.body}</Text>
      ) : null}
      {t.rejectionReason ? (
        <Text style={{ ...type.caption, color: colors.danger, ...rtlText }}>سبب الرفض: {t.rejectionReason}</Text>
      ) : null}
    </View>
  );
}
