import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { CallPermissionPill } from "@/components/inbox/call-permission-pill";
import { IconSymbol, type IconName } from "@/components/ui/icon-symbol";
import { hitSize, radius, rtlText, spacing, type } from "@/constants/theme";
import { tapFeedback } from "@/lib/haptics";
import { queryKeys } from "@/lib/queries";
import { OutboundCall, type CallState } from "@/lib/webrtc/outbound-call";
import { useTheme } from "@/providers/theme-provider";
import { useQueryClient } from "@tanstack/react-query";

const IDLE: CallState = {
  phase: "idle",
  waCallId: null,
  error: null,
  relayMissing: false,
  startedAt: null,
  speaker: false,
  muted: false,
};

/** `03:41`. Monospaced digits are not available here, so the width is fixed. */
function elapsed(startedAt: number | null, now: number): string {
  if (!startedAt) return "00:00";
  const total = Math.max(0, Math.floor((now - startedAt) / 1000));
  const minutes = String(Math.floor(total / 60)).padStart(2, "0");
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

/** A round icon button sized for a thumb rather than a cursor. */
function CallButton({
  icon,
  label,
  onPress,
  background,
  foreground,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  background: string;
  foreground: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        tapFeedback();
        onPress();
      }}
      style={({ pressed }) => ({
        alignItems: "center",
        justifyContent: "center",
        width: hitSize.min,
        height: hitSize.min,
        borderRadius: radius.full,
        backgroundColor: background,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <IconSymbol name={icon} size={18} color={foreground} />
    </Pressable>
  );
}

/**
 * Calling a customer from the thread, and everything that state implies.
 *
 * Idle, this is the permission pill: WhatsApp forbids cold-calling, so the
 * usual answer is "ask first", not "dial". Once a call is up it takes the
 * whole row — a live call outranks every permission state because it is the
 * only thing on this screen happening right now, and on a phone there is no
 * second place to put it.
 *
 * The call itself lives in a ref rather than in state: it outlives any render,
 * and hanging up has to happen exactly once.
 *
 * Navigating *forward* — into the order, the customer, the calendar — keeps the
 * call up, because the thread stays mounted underneath. Going back to the inbox
 * unmounts it and ends the call. That is a deliberate floor rather than the
 * finished behaviour: a live call with no visible control anywhere is worse
 * than one that ends where the employee left it. Surviving a pop needs the call
 * hoisted above the navigator, with a persistent bar to hang up from.
 */
export function CallControl({
  conversationId,
  enabled,
}: {
  conversationId: string;
  /** Groups carry a jid in `customer_phone`; there is nobody to call. */
  enabled: boolean;
}) {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [call, setCall] = useState<CallState>(IDLE);
  const [now, setNow] = useState(() => Date.now());
  const callRef = useRef<OutboundCall | null>(null);

  useEffect(() => {
    if (call.phase !== "connected") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [call.phase]);

  useEffect(() => {
    return () => {
      void callRef.current?.dispose();
      callRef.current = null;
    };
  }, []);

  const startCall = useCallback(async () => {
    if (callRef.current) return;
    const session = new OutboundCall();
    callRef.current = session;

    session.subscribe((state) => {
      setCall(state);
      if (state.phase === "ended" || state.phase === "failed") {
        callRef.current = null;
        // Meta may have revoked permission as part of ending the call — four
        // unanswered calls do exactly that — so re-read rather than assume.
        void queryClient.invalidateQueries({
          queryKey: queryKeys.callPermission(conversationId),
        });
      }
    });

    await session.start(conversationId);
  }, [conversationId, queryClient]);

  const hangUp = useCallback(async () => {
    await callRef.current?.hangUp();
    callRef.current = null;
  }, []);

  if (!enabled) return null;

  const live =
    call.phase === "preparing" ||
    call.phase === "dialling" ||
    call.phase === "ringing" ||
    call.phase === "connected";

  if (live) {
    const label =
      call.phase === "connected"
        ? elapsed(call.startedAt, now)
        : call.phase === "ringing"
          ? "جاري الرنين…"
          : "جاري الاتصال…";

    return (
      <View
        style={{
          flexDirection: "row-reverse",
          alignItems: "center",
          gap: spacing.sm,
        }}
      >
        <View
          style={{
            flexDirection: "row-reverse",
            alignItems: "center",
            gap: spacing.xs,
            paddingHorizontal: spacing.sm + 2,
            paddingVertical: spacing.xs + 1,
            borderRadius: radius.full,
            backgroundColor: colors.successSoft,
          }}
        >
          <View
            accessible={false}
            style={{
              width: 8,
              height: 8,
              borderRadius: radius.full,
              backgroundColor: colors.success,
            }}
          />
          <Text
            accessibilityLiveRegion="polite"
            style={{ ...type.caption, color: colors.onSuccessSoft, ...rtlText }}
          >
            {label}
          </Text>
          {/* Media may have nowhere to relay. The call still goes ahead — on
              most networks it connects — but on a carrier-grade NAT it rings,
              connects, and carries no audio, which is unexplainable without
              this. */}
          {call.relayMissing ? (
            <IconSymbol
              name="exclamationmark.triangle"
              size={12}
              color={colors.warning}
            />
          ) : null}
        </View>

        <CallButton
          icon={call.muted ? "mic.slash" : "mic"}
          label={call.muted ? "إلغاء كتم الميكروفون" : "كتم الميكروفون"}
          onPress={() => callRef.current?.setMuted(!call.muted)}
          background={call.muted ? colors.brand : colors.surfaceSunken}
          foreground={call.muted ? colors.onBrand : colors.textSecondary}
        />
        <CallButton
          icon="speaker.wave.2"
          label={call.speaker ? "إيقاف مكبر الصوت" : "تشغيل مكبر الصوت"}
          onPress={() => callRef.current?.setSpeaker(!call.speaker)}
          background={call.speaker ? colors.brand : colors.surfaceSunken}
          foreground={call.speaker ? colors.onBrand : colors.textSecondary}
        />
        <CallButton
          icon="phone.down"
          label="إنهاء المكالمة"
          onPress={() => void hangUp()}
          background={colors.danger}
          foreground={colors.onDanger}
        />
      </View>
    );
  }

  return (
    <View
      style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.xs }}
    >
      <CallPermissionPill
        conversationId={conversationId}
        enabled={enabled}
        onCall={() => void startCall()}
      />
      {/* Why the last attempt failed. Sits beside the control that produced it,
          because the alternative — an alert — is dismissed before it is read. */}
      {call.error ? (
        <Text
          numberOfLines={1}
          style={{
            ...type.caption,
            color: colors.danger,
            ...rtlText,
            flexShrink: 1,
            maxWidth: 160,
          }}
        >
          {call.error}
        </Text>
      ) : null}
    </View>
  );
}
