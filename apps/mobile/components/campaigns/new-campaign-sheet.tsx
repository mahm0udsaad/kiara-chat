import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { InlineAlert } from "@/components/screen-state";
import { PrimaryButton } from "@/components/primary-button";
import { radius, rtlText, spacing, type } from "@/constants/theme";
import { successFeedback, tapFeedback } from "@/lib/haptics";
import { useCreateCampaign } from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";
import type { CampaignSegment, CampaignTemplate, CampaignsResponse } from "@/types/api";

/**
 * Create an استهداف: pick an approved template, pick a segment, send. The send
 * runs server-side, so this only needs to fire the request and close.
 */
export function NewCampaignSheet({
  open,
  templates,
  segments,
  segmentCounts,
  onClose,
}: {
  open: boolean;
  templates: CampaignTemplate[];
  segments: CampaignsResponse["segments"];
  segmentCounts: CampaignsResponse["segmentCounts"];
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const create = useCreateCampaign();

  const approved = useMemo(() => templates.filter((t) => t.status === "approved"), [templates]);
  const [templateSid, setTemplateSid] = useState<string | null>(null);
  const [segment, setSegment] = useState<CampaignSegment>("all");
  const [error, setError] = useState<string | null>(null);

  const template = approved.find((t) => t.sid === templateSid) ?? null;
  const close = () => { setTemplateSid(null); setSegment("all"); setError(null); onClose(); };

  const submit = () => {
    setError(null);
    if (!template) return setError("اختاري قالبًا معتمدًا.");
    create.mutate(
      {
        contentSid: template.sid,
        templateName: template.name,
        category: template.category ?? "MARKETING",
        segment,
      },
      {
        onSuccess: () => { successFeedback(); close(); },
        onError: (e: Error) => setError(e.message),
      },
    );
  };

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
      <Pressable
        onPress={close}
        style={{ flex: 1, justifyContent: "flex-end", backgroundColor: colors.overlay }}
      >
        <Pressable
          onPress={() => {}}
          style={{
            maxHeight: "90%",
            padding: spacing.lg,
            paddingBottom: spacing.lg + insets.bottom,
            gap: spacing.md,
            borderTopLeftRadius: radius["2xl"],
            borderTopRightRadius: radius["2xl"],
            backgroundColor: colors.surface,
          }}
        >
          <Text style={{ ...type.title3, color: colors.text, ...rtlText }}>استهداف جديد</Text>
          {error ? <InlineAlert message={error} /> : null}

          {!approved.length ? (
            <Text style={{ ...type.body, color: colors.textSecondary, ...rtlText }}>
              لا توجد قوالب معتمدة بعد. أنشئي قالبًا وانتظري اعتماده لبدء استهداف.
            </Text>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled">
              <View style={{ gap: spacing.md }}>
                <Text style={{ ...type.caption, color: colors.textSecondary, ...rtlText }}>القالب</Text>
                <View style={{ gap: spacing.sm }}>
                  {approved.map((t) => (
                    <Pressable
                      key={t.sid}
                      onPress={() => { tapFeedback(); setTemplateSid(t.sid); }}
                      style={{
                        padding: spacing.lg,
                        borderRadius: radius.lg,
                        borderWidth: 1,
                        borderColor: templateSid === t.sid ? colors.brand : colors.border,
                        backgroundColor: templateSid === t.sid ? colors.surfaceSunken : colors.surface,
                        gap: 4,
                      }}
                    >
                      <Text style={{ ...type.bodyStrong, color: colors.text, ...rtlText }}>{t.name}</Text>
                      <Text numberOfLines={2} style={{ ...type.caption, color: colors.textSecondary, ...rtlText }}>
                        {t.body || t.contentType}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={{ ...type.caption, color: colors.textSecondary, ...rtlText }}>الفئة المستهدفة</Text>
                <View style={{ gap: spacing.xs }}>
                  {segments.map((s) => (
                    <Pressable
                      key={s.key}
                      onPress={() => { tapFeedback(); setSegment(s.key); }}
                      style={{
                        flexDirection: "row-reverse",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: spacing.lg,
                        borderRadius: radius.lg,
                        borderWidth: 1,
                        borderColor: segment === s.key ? colors.brand : colors.border,
                        backgroundColor: segment === s.key ? colors.surfaceSunken : colors.surface,
                      }}
                    >
                      <View>
                        <Text style={{ ...type.body, color: colors.text, ...rtlText }}>{s.label}</Text>
                        <Text style={{ ...type.caption, color: colors.textTertiary, ...rtlText }}>{s.hint}</Text>
                      </View>
                      <Text style={{ ...type.title3, color: colors.brand }}>{segmentCounts[s.key] ?? 0}</Text>
                    </Pressable>
                  ))}
                </View>

                <PrimaryButton
                  label={create.isPending ? "جارٍ البدء…" : "بدء الاستهداف"}
                  onPress={submit}
                  disabled={create.isPending || !template}
                />
                <Pressable onPress={close} style={{ alignItems: "center", paddingVertical: spacing.sm }}>
                  <Text style={{ ...type.caption, color: colors.textSecondary }}>إلغاء</Text>
                </Pressable>
              </View>
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
