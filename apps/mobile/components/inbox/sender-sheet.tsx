import { Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { hitSize, numeric, radius, rtlText, spacing, type } from "@/constants/theme";
import { tapFeedback } from "@/lib/haptics";
import { formatPhone } from "@/lib/format";
import { useTheme } from "@/providers/theme-provider";
import type { WhatsAppSender } from "@/types/api";

/**
 * «الإرسال من رقم آخر»: the business numbers she may reply from. Opened from
 * the composer's + menu; picking one switches this customer for the team.
 */

export const PROVIDER_LABEL: Record<WhatsAppSender["provider"], string> = {
  meta: "Meta Cloud API",
  openwa: "OpenWA",
};

const UNAVAILABLE_LABEL: Record<NonNullable<WhatsAppSender["unavailableReason"]>, string> = {
  disabled: "موقوف",
  not_configured: "غير مُعدّ",
  disconnected: "غير متصل",
  unreachable: "لا يستجيب",
};

/**
 * A phone number kept left-to-right inside Arabic text. Without the isolate
 * marks the digit groups are laid out right-to-left: "748 421 508 966+".
 */
export function ltrPhone(phone: string): string {
  return `\u2066${formatPhone(phone)}\u2069`;
}

export function senderSummary(sender: Pick<WhatsAppSender, "phone" | "label" | "provider">): string {
  return `${sender.phone ? ltrPhone(sender.phone) : sender.label} · ${PROVIDER_LABEL[sender.provider]}`;
}

export function SenderSheet({
  open,
  senders,
  selectedId,
  onPick,
  onClose,
}: {
  open: boolean;
  senders: WhatsAppSender[];
  selectedId: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="إغلاق القائمة"
        onPress={onClose}
        style={{ flex: 1, justifyContent: "flex-end", backgroundColor: colors.overlay }}
      >
        <Pressable
          onPress={() => {}}
          style={{
            gap: spacing.xs,
            padding: spacing.lg,
            paddingBottom: spacing.lg + insets.bottom,
            borderTopLeftRadius: radius["2xl"],
            borderTopRightRadius: radius["2xl"],
            borderCurve: "continuous",
            backgroundColor: colors.surface,
          }}
        >
          <Text style={{ ...type.headline, ...rtlText, color: colors.text, paddingHorizontal: spacing.md }}>
            الإرسال من رقم آخر
          </Text>
          <Text style={{ ...type.footnote, ...rtlText, color: colors.textSecondary, paddingHorizontal: spacing.md }}>
            يُحفظ لهذه العميلة ويراه كل الفريق.
          </Text>
          {senders.map((sender) => {
            const selected = sender.id === selectedId;
            const disabled = !sender.available && !selected;
            return (
              <Pressable
                key={sender.id}
                accessibilityRole="radio"
                accessibilityState={{ selected, disabled }}
                accessibilityLabel={`${senderSummary(sender)}${sender.available ? "" : `، ${UNAVAILABLE_LABEL[sender.unavailableReason ?? "disconnected"]}`}`}
                disabled={disabled}
                onPress={() => {
                  tapFeedback();
                  onPick(sender.id);
                }}
                style={({ pressed }) => ({
                  flexDirection: "row-reverse",
                  alignItems: "center",
                  gap: spacing.md,
                  minHeight: hitSize.control,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.sm,
                  borderRadius: radius.lg,
                  borderCurve: "continuous",
                  backgroundColor: selected ? colors.brandSoft : pressed ? colors.surfaceSunken : "transparent",
                  opacity: disabled ? 0.5 : 1,
                })}
              >
                <View style={{ width: 22, alignItems: "center" }}>
                  {selected ? <IconSymbol name="checkmark" color={colors.brand} size={18} /> : null}
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ ...type.bodyStrong, ...numeric, ...rtlText, color: colors.text }}>
                    {sender.phone ? ltrPhone(sender.phone) : sender.label}
                  </Text>
                  <Text style={{ ...type.caption, ...rtlText, color: colors.textSecondary }}>
                    {PROVIDER_LABEL[sender.provider]}
                    {sender.isDefault ? " · الافتراضي" : ""}
                    {sender.available ? "" : ` · ${UNAVAILABLE_LABEL[sender.unavailableReason ?? "disconnected"]}`}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
