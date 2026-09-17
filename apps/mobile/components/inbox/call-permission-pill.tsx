import { Pressable, Text, View } from "react-native";

import { Badge } from "@/components/ui/badge";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { hitSize, radius, rtlText, spacing, type } from "@/constants/theme";
import { tapFeedback } from "@/lib/haptics";
import { useCallPermission, useRequestCallPermission } from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";

type Props = {
  conversationId: string;
  /** Groups carry a jid in `customer_phone`; there is nobody to call. */
  enabled: boolean;
  /**
   * Place the call. Given only when the device can actually carry one — the
   * permission badge stays passive without it, so a build whose native WebRTC
   * module is missing says "calling is allowed" without offering a button that
   * cannot work.
   */
  onCall?: () => void;
};

/** Days left on a temporary grant, floored — "ينتهي اليوم" below one. */
function expiryLabel(expiresAt: string | null): string | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const days = Math.floor(ms / 86_400_000);
  if (days <= 0) return "ينتهي اليوم";
  if (days === 1) return "يوم واحد";
  if (days === 2) return "يومان";
  return `${days} أيام`;
}

/**
 * Whether the spa may call this customer, and the one action that changes it.
 *
 * WhatsApp forbids cold-calling: permission has to be asked for and granted,
 * a temporary grant lasts a week, and asking again is capped at once a day and
 * twice a week. So this is never a plain button — an employee who taps into a
 * rate limit has burned a real allowance and the customer sees nothing. The
 * disabled states each say why.
 */
export function CallPermissionPill({ conversationId, enabled, onCall }: Props) {
  const { colors } = useTheme();
  const permission = useCallPermission(conversationId, enabled);
  const request = useRequestCallPermission(conversationId);

  // Permission is an extra capability, not part of reading a thread. A failed
  // lookup hides the pill rather than pushing an error into the header.
  if (!enabled || permission.isLoading || permission.isError || !permission.data) {
    return null;
  }

  const { callable, status, expiresAt, requestAvailable, requestChannel, authoritative } =
    permission.data;

  if (callable) {
    const remaining = expiryLabel(expiresAt);
    // The grant is temporary, so the remaining days stay on the control rather
    // than moving to a tooltip nobody on a phone can open.
    const label = remaining ? `اتصال · ${remaining}` : "اتصال";

    if (!onCall) {
      return (
        <Badge
          tone="success"
          icon="phone"
          label={remaining ? `الاتصال مسموح · ${remaining}` : "الاتصال مسموح"}
        />
      );
    }

    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="اتصال صوتي عبر واتساب"
        accessibilityHint="يبدأ مكالمة صوتية مع العميلة الآن"
        onPress={() => {
          tapFeedback();
          onCall();
        }}
        style={({ pressed }) => ({
          flexDirection: "row-reverse",
          alignItems: "center",
          gap: spacing.xs,
          minHeight: hitSize.min - 8,
          paddingHorizontal: spacing.sm + 2,
          borderRadius: radius.full,
          backgroundColor: pressed ? colors.success : colors.successSoft,
        })}
      >
        {({ pressed }) => (
          <>
            <IconSymbol
              name="phone"
              size={14}
              color={pressed ? colors.onSuccess : colors.onSuccessSoft}
            />
            <Text
              style={{
                ...type.caption,
                color: pressed ? colors.onSuccess : colors.onSuccessSoft,
                ...rtlText,
              }}
            >
              {label}
            </Text>
          </>
        )}
      </Pressable>
    );
  }

  if (status === "requested") {
    return <Badge tone="info" icon="clock" label="بانتظار رد العميلة" />;
  }

  if (!requestAvailable) {
    // Two different reasons, and the employee can act on only one of them:
    // a closed window reopens when the customer writes again, whereas the ask
    // quota is simply spent.
    return (
      <Badge
        tone="neutral"
        icon="phone.down"
        label={
          requestChannel === "template"
            ? "لطلب الإذن انتظري رد العميلة"
            : "تم طلب الإذن مؤخرًا"
        }
      />
    );
  }

  const busy = request.isPending;
  const failed = request.isError;

  return (
    <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.xs }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="طلب إذن الاتصال"
        accessibilityHint="يرسل للعميلة رسالة تطلب السماح بالاتصال عبر واتساب"
        accessibilityState={{ disabled: busy, busy }}
        disabled={busy}
        onPress={() => {
          tapFeedback();
          request.mutate(undefined);
        }}
        style={({ pressed }) => ({
          flexDirection: "row-reverse",
          alignItems: "center",
          gap: spacing.xs,
          minHeight: hitSize.min - 8,
          paddingHorizontal: spacing.sm + 2,
          borderRadius: radius.full,
          backgroundColor: pressed ? colors.brand : colors.brandSoft,
          opacity: busy ? 0.45 : 1,
        })}
      >
        {({ pressed }) => (
          <>
            <IconSymbol
              name="phone.badge.plus"
              size={14}
              color={pressed ? colors.onBrand : colors.onBrandSoft}
            />
            <Text
              style={{
                ...type.caption,
                color: pressed ? colors.onBrand : colors.onBrandSoft,
                ...rtlText,
              }}
            >
              {busy ? "جارٍ الإرسال…" : "طلب إذن الاتصال"}
            </Text>
          </>
        )}
      </Pressable>
      {failed ? (
        <Text
          numberOfLines={1}
          style={{ ...type.caption, color: colors.danger, ...rtlText, flexShrink: 1 }}
        >
          {request.error.message}
        </Text>
      ) : null}
      {/* Graph was unreachable, so this state is remembered rather than
          checked. Worth saying: acting on it can still fail. */}
      {!authoritative ? (
        <IconSymbol name="exclamationmark.triangle" size={12} color={colors.textTertiary} />
      ) : null}
    </View>
  );
}
