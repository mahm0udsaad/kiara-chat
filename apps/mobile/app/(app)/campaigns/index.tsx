import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { NewCampaignSheet } from "@/components/campaigns/new-campaign-sheet";
import { NewTemplateSheet } from "@/components/campaigns/new-template-sheet";
import {
  CAMPAIGN_STATUS_META,
  SEGMENT_META,
  TEMPLATE_STATUS_META,
  TEMPLATE_TYPE_META,
} from "@/components/campaigns/meta";
import { EmptyState, ErrorState, LoadingScreen } from "@/components/screen-state";
import { PrimaryButton } from "@/components/primary-button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { Segmented } from "@/components/ui/segmented";
import { radius, rtlText, spacing, type } from "@/constants/theme";
import { tapFeedback } from "@/lib/haptics";
import { useCampaignTemplates, useCampaigns, useSetCampaignStatus } from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";
import type { Campaign, CampaignSegment, CampaignTemplate } from "@/types/api";

type Tab = "campaigns" | "templates";
const TABS = [
  { value: "campaigns" as const, label: "الحملات" },
  { value: "templates" as const, label: "القوالب" },
];

export default function CampaignsScreen() {
  const { colors } = useTheme();
  const [tab, setTab] = useState<Tab>("campaigns");
  const [newTemplate, setNewTemplate] = useState(false);
  const [newCampaign, setNewCampaign] = useState(false);

  const templates = useCampaignTemplates();
  const campaigns = useCampaigns();
  const setStatus = useSetCampaignStatus();

  if (templates.isLoading && campaigns.isLoading) return <LoadingScreen label="جارٍ التحميل…" />;

  const approvedCount = (templates.data?.templates ?? []).filter((t) => t.status === "approved").length;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ padding: spacing.lg, paddingBottom: spacing.sm, gap: spacing.md }}>
        <Segmented accessibilityLabel="عرض" options={TABS} value={tab} onChange={(v) => { tapFeedback(); setTab(v); }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: 0, gap: spacing.md }}>
        {/* One-line explainer so the screen says what it is at a glance. */}
        <View
          style={{
            flexDirection: "row-reverse",
            alignItems: "center",
            gap: spacing.sm,
            padding: spacing.md,
            borderRadius: radius.lg,
            backgroundColor: colors.surfaceSunken,
          }}
        >
          <IconSymbol name="paperplane.fill" color={colors.brand} size={18} />
          <Text style={{ ...type.caption, color: colors.textSecondary, flex: 1, ...rtlText }}>
            {tab === "campaigns"
              ? "أرسلي قالبًا معتمدًا إلى فئة من العملاء. الإرسال يتم تلقائيًا على الخادم."
              : "أنشئي قالب رسالة وأرسليه للاعتماد. بعد الاعتماد يصبح جاهزًا للحملات."}
          </Text>
        </View>

        {tab === "campaigns" ? (
          <>
            <PrimaryButton
              label={approvedCount ? "استهداف جديد" : "استهداف جديد (يلزم قالب معتمد)"}
              icon="plus"
              onPress={() => setNewCampaign(true)}
              disabled={!approvedCount}
            />
            {campaigns.isError ? (
              <ErrorState title="تعذر التحميل" message={campaigns.error.message} onRetry={() => void campaigns.refetch()} />
            ) : !campaigns.data?.campaigns.length ? (
              <EmptyState icon="paperplane.fill" title="لا توجد حملات بعد" detail="ابدئي استهدافًا لإرسال قالب معتمد لفئة عملاء." />
            ) : (
              campaigns.data.campaigns.map((c) => (
                <CampaignCard
                  key={c.id}
                  c={c}
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
              templates.data.templates.map((t) => <TemplateCard key={t.sid} t={t} />)
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

function CampaignCard({ c, onToggle, busy }: { c: Campaign; onToggle: () => void; busy: boolean }) {
  const { colors } = useTheme();
  const st = CAMPAIGN_STATUS_META[c.status] ?? { label: c.status, tone: "neutral" as const, icon: "checkmark.circle" as const };
  const seg = SEGMENT_META[c.segment as CampaignSegment] ?? SEGMENT_META.all;
  const pct = c.total ? Math.round((c.sent / c.total) * 100) : 0;
  return (
    <Card>
      <View style={{ flexDirection: "row-reverse", justifyContent: "space-between", alignItems: "center", gap: spacing.sm }}>
        <Text style={{ ...type.bodyStrong, color: colors.text, flex: 1, ...rtlText }} numberOfLines={1}>
          {c.templateName}
        </Text>
        <Badge label={st.label} tone={st.tone} icon={st.icon} />
      </View>

      <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: 6, marginTop: 4 }}>
        <IconSymbol name={seg.icon} color={colors.textTertiary} size={13} />
        <Text style={{ ...type.caption, color: colors.textSecondary, ...rtlText }}>{seg.label}</Text>
      </View>

      <View style={{ height: 8, borderRadius: radius.full, backgroundColor: colors.surfaceSunken, overflow: "hidden", marginTop: spacing.sm }}>
        <View style={{ height: "100%", width: `${pct}%`, backgroundColor: colors.success }} />
      </View>
      <View style={{ flexDirection: "row-reverse", justifyContent: "space-between", marginTop: 6 }}>
        <Text style={{ ...type.caption, color: colors.textSecondary, ...rtlText }}>
          {c.sent} / {c.total} ({pct}%)
        </Text>
        {c.remaining > 0 ? (
          <Text style={{ ...type.caption, color: colors.textTertiary, ...rtlText }}>المتبقّي {c.remaining}</Text>
        ) : null}
      </View>

      {c.status !== "done" ? (
        <Pressable
          onPress={() => { tapFeedback(); onToggle(); }}
          disabled={busy}
          style={{
            flexDirection: "row-reverse",
            alignItems: "center",
            gap: 6,
            alignSelf: "flex-start",
            marginTop: spacing.sm,
            paddingVertical: 6,
            paddingHorizontal: spacing.md,
            borderRadius: radius.full,
            backgroundColor: colors.surfaceSunken,
          }}
        >
          <IconSymbol name={c.status === "active" ? "pause.fill" : "play.fill"} color={colors.brand} size={13} />
          <Text style={{ ...type.caption, color: colors.brand }}>{c.status === "active" ? "إيقاف مؤقت" : "استئناف"}</Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

function TemplateCard({ t }: { t: CampaignTemplate }) {
  const { colors } = useTheme();
  const st = TEMPLATE_STATUS_META[t.status] ?? { label: t.status, tone: "neutral" as const, icon: "pencil" as const };
  const ty = TEMPLATE_TYPE_META[t.contentType] ?? { label: t.contentType, icon: "doc.text" as const };
  return (
    <Card>
      <View style={{ flexDirection: "row-reverse", justifyContent: "space-between", alignItems: "center", gap: spacing.sm }}>
        <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: 6, flex: 1 }}>
          <IconSymbol name={ty.icon} color={colors.brand} size={15} />
          <Text style={{ ...type.bodyStrong, color: colors.text, flex: 1, ...rtlText }} numberOfLines={1}>{t.name}</Text>
        </View>
        <Badge label={st.label} tone={st.tone} icon={st.icon} />
      </View>
      {t.body ? (
        <Text numberOfLines={3} style={{ ...type.caption, color: colors.textSecondary, marginTop: 6, ...rtlText }}>{t.body}</Text>
      ) : null}
      {t.rejectionReason ? (
        <View style={{ flexDirection: "row-reverse", alignItems: "flex-start", gap: 6, marginTop: 6 }}>
          <IconSymbol name="exclamationmark.triangle" color={colors.danger} size={13} />
          <Text style={{ ...type.caption, color: colors.danger, flex: 1, ...rtlText }}>{t.rejectionReason}</Text>
        </View>
      ) : null}
    </Card>
  );
}
