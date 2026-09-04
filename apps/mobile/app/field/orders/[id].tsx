import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo } from "react";
import { Alert, Image, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ActionBar, PrimaryButton } from "@/components/primary-button";
import { ErrorState, InlineAlert, LoadingScreen } from "@/components/screen-state";
import { Badge } from "@/components/ui/badge";
import { Card, Divider } from "@/components/ui/card";
import { DetailRow, SectionHeader } from "@/components/ui/detail-row";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { hitSize, radius, spacing, type } from "@/constants/theme";
import {
  formatPhone,
  locationLabel,
  locationUrl,
} from "@/lib/format";
import { useFieldI18n } from "@/lib/field-i18n";
import { successFeedback } from "@/lib/haptics";
import { useFieldOrder, useFieldOrderAction } from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";
import type { FieldOrder } from "@/types/api";

function ProgressRail({ order }: { order: FieldOrder }) {
  const { colors } = useTheme();
  const { rowDirection, t } = useFieldI18n();
  const stepLabels = [
    t("stepConfirmRide"),
    t("stepPickup"),
    t("stepStartService"),
    t("stepCompleteService"),
    t("stepDriverReturn"),
  ];
  const done = [
    Boolean(order.progress.driverConfirmedAt),
    Boolean(order.progress.specialistPickupAt),
    Boolean(order.progress.serviceStartedAt),
    Boolean(order.progress.completedAt),
    Boolean(order.progress.driverReturnedAt),
  ];
  return (
    <View style={{ flexDirection: rowDirection, alignItems: "flex-start", gap: spacing.xs }}>
      {stepLabels.map((label, index) => (
        <View key={label} style={{ flex: 1, alignItems: "center", gap: spacing.xs }}>
          <View
            style={{
              width: 24,
              height: 24,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: radius.full,
              borderWidth: done[index] ? 0 : 1,
              borderColor: colors.borderStrong,
              backgroundColor: done[index] ? colors.success : colors.surface,
            }}
          >
            {done[index] ? (
              <IconSymbol name="checkmark" size={13} color={colors.onBrand} />
            ) : (
              <Text style={{ ...type.caption, color: colors.textTertiary }}>{index + 1}</Text>
            )}
          </View>
          <Text
            numberOfLines={2}
            style={{ ...type.caption, textAlign: "center", color: done[index] ? colors.text : colors.textTertiary }}
          >
            {label}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * The dispatch note, as the office wrote it, with whatever was attached to it.
 *
 * The same text arrives as a WhatsApp message on a personal phone, but that
 * copy is separate from the order it describes and buried by next week.
 * Keeping it here means the person doing the visit reads it next to the
 * address and the steps.
 *
 * The attachments differ by role, and the server decides which one it signs:
 * the recording is the specialist's, the door photo is the driver's.
 */
function DispatchNote({ order }: { order: FieldOrder }) {
  const { colors } = useTheme();
  const { t, textStyle } = useFieldI18n();
  if (!order.note && !order.voiceNoteUrl && !order.doorPhotoUrl) return null;
  const hasAttachment = Boolean(order.voiceNoteUrl || order.doorPhotoUrl);
  return (
    <View style={{ gap: spacing.sm }}>
      <SectionHeader title={t("managementNotes")} />
      <Card style={{ gap: spacing.md }}>
        {order.note ? (
          <Text selectable style={{ ...type.body, color: colors.text, ...textStyle }}>
            {order.note}
          </Text>
        ) : null}
        {order.note && hasAttachment ? <Divider /> : null}
        {order.voiceNoteUrl ? <VoiceNote url={order.voiceNoteUrl} /> : null}
        {order.doorPhotoUrl ? <DoorPhoto url={order.doorPhotoUrl} /> : null}
      </Card>
    </View>
  );
}

/**
 * The customer's door. Shown large enough to recognise a gate from — a
 * thumbnail would defeat the point of sending it.
 */
function DoorPhoto({ url }: { url: string }) {
  const { colors } = useTheme();
  const { rowDirection, t, textStyle } = useFieldI18n();
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: rowDirection, alignItems: "center", gap: spacing.xs }}>
        <IconSymbol name="mappin.and.ellipse" size={16} color={colors.textSecondary} />
        <Text style={{ ...type.footnote, color: colors.textSecondary, ...textStyle }}>
          {t("customerDoor")}
        </Text>
      </View>
      <Image
        source={{ uri: url }}
        accessibilityLabel={t("customerDoorPhoto")}
        resizeMode="cover"
        style={{
          width: "100%",
          aspectRatio: 4 / 3,
          borderRadius: radius.md,
          backgroundColor: colors.surfaceSunken,
        }}
      />
    </View>
  );
}

/** Playback for the recorded half of the note. */
function VoiceNote({ url }: { url: string }) {
  const { colors } = useTheme();
  const { rowDirection, t, textStyle } = useFieldI18n();
  const player = useAudioPlayer({ uri: url });
  const status = useAudioPlayerStatus(player);

  // Playback leaves the head at the end; rewinding here means a second tap
  // replays the note instead of doing nothing.
  useEffect(() => {
    if (status.didJustFinish) void player.seekTo(0);
  }, [status.didJustFinish, player]);

  return (
    <View style={{ flexDirection: rowDirection, alignItems: "center", gap: spacing.sm }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={status.playing ? t("stopListening") : t("listenToNote")}
        onPress={() => (status.playing ? player.pause() : player.play())}
        style={({ pressed }) => ({
          width: hitSize.min,
          height: hitSize.min,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: radius.full,
          backgroundColor: colors.brandSoft,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <IconSymbol
          name={status.playing ? "pause.fill" : "play.fill"}
          color={colors.onBrandSoft}
          size={18}
        />
      </Pressable>
      <IconSymbol name="waveform" color={colors.textSecondary} size={18} />
      <Text style={{ flex: 1, ...type.footnote, color: colors.textSecondary, ...textStyle }}>
        {t("managementVoiceNote")}
      </Text>
    </View>
  );
}

export default function FieldOrderDetailScreen() {
  const { colors } = useTheme();
  const {
    actionLabel,
    confirmation,
    duration,
    formatTime,
    isRtl,
    relativeDay,
    rowDirection,
    t,
    textStyle,
    tripType,
  } = useFieldI18n();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = useMemo(() => (Array.isArray(params.id) ? params.id[0] ?? "" : params.id ?? ""), [params.id]);
  const detail = useFieldOrder(id);
  const action = useFieldOrderAction(id);
  if (detail.isLoading) return <LoadingScreen label={t("loadingOrder")} />;
  if (detail.isError || !detail.data) {
    return <ErrorState title={t("orderLoadError")} message={detail.error ? t("orderLoadError") : t("orderNotFound")} onRetry={() => void detail.refetch()} />;
  }
  const order = detail.data.order;
  const next = order.nextAction;
  const confirm = () => {
    if (!next) return;
    const copy = confirmation(next);
    Alert.alert(copy.title, copy.body, [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("confirm"),
        onPress: () =>
          action.mutate(
            { action: next, expectedVersion: order.progress.version },
            { onSuccess: () => successFeedback() },
          ),
      },
    ]);
  };
  // The driver's non-blocking "I've arrived" ping — fires straight away and
  // just notifies the specialist; it never gates her next step.
  const pingArrival = () =>
    action.mutate(
      { action: "driver_arrived", expectedVersion: order.progress.version },
      { onSuccess: () => successFeedback() },
    );
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing["4xl"] }}
      >
        <Card style={{ gap: spacing.lg }}>
          <View style={{ flexDirection: rowDirection, alignItems: "center", gap: spacing.md }}>
            <View style={{ flex: 1, gap: spacing.xs }}>
              <Text style={{ ...type.title2, color: colors.text, ...textStyle }}>
                {order.customerName || t("customer")}
              </Text>
              <Text selectable style={{ ...type.footnote, color: colors.textSecondary, ...textStyle, writingDirection: "ltr" }}>
                {formatPhone(order.customerPhone)}
              </Text>
            </View>
            <Badge
              label={order.progress.driverReturnedAt ? t("completed") : order.canAct ? t("waitingForYou") : t("waitingNextStep")}
              tone={order.progress.driverReturnedAt ? "success" : order.canAct ? "warning" : "neutral"}
              icon={order.progress.driverReturnedAt ? "checkmark.circle" : "clock"}
            />
          </View>
          <Divider />
          <ProgressRail order={order} />
        </Card>

        <View style={{ gap: spacing.sm }}>
          <SectionHeader title={t("orderDetailsSection")} />
          <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
            <DetailRow icon="calendar" label={t("appointment")} value={`${relativeDay(order.arrivalAt)} · ${formatTime(order.arrivalAt)}`} />
            <Divider inset={46} />
            <DetailRow icon="clock" label={t("serviceDuration")} value={duration(order.durationMinutes)} />
            <Divider inset={46} />
            <DetailRow icon="car" label={t("tripType")} value={tripType(order.tripType)} />
            <Divider inset={46} />
            <DetailRow
              icon="mappin.and.ellipse"
              label={t("customerLocation")}
              value={locationLabel(order.customerLocation, t("mapLocation"))}
              actionIcon={isRtl ? "chevron.left" : "chevron.right"}
              actionLabel={t("openLocation")}
              onPress={() => void Linking.openURL(locationUrl(order.customerLocation))}
            />
          </Card>
        </View>

        <DispatchNote order={order} />

        <View style={{ gap: spacing.sm }}>
          <SectionHeader title={t("orderTeam")} />
          <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
            <DetailRow icon="sparkles" label={t("specialist")} value={order.specialistName ?? t("unassignedFeminine")} />
            <Divider inset={46} />
            <DetailRow icon="car" label={t("driver")} value={order.driverName ?? t("unassignedMasculine")} />
          </Card>
        </View>

        <View
          style={{
            flexDirection: rowDirection,
            alignItems: "flex-start",
            gap: spacing.sm,
            padding: spacing.md,
            borderRadius: radius.md,
            backgroundColor: colors.brandSoft,
          }}
        >
          <IconSymbol name="bell" size={17} color={colors.onBrandSoft} />
          <Text style={{ flex: 1, ...type.footnote, color: colors.onBrandSoft, ...textStyle }}>
            {t("automaticReminder")}
          </Text>
        </View>
        {action.error ? <InlineAlert message={t("actionFailed")} /> : null}
      </ScrollView>

      <ActionBar bottomInset={insets.bottom}>
        {order.canPingArrival ? (
          <PrimaryButton
            label={t("driverArrived")}
            icon="mappin.and.ellipse"
            loading={action.isPending}
            onPress={pingArrival}
          />
        ) : null}
        {next && order.canAct ? (
          <PrimaryButton label={actionLabel(next)} icon="checkmark.circle" loading={action.isPending} onPress={confirm} />
        ) : next ? (
          <PrimaryButton label={actionLabel(next)} icon="hourglass" variant="tinted" disabled onPress={() => undefined} />
        ) : (
          <PrimaryButton label={t("orderFinished")} icon="checkmark.circle" tone="success" variant="tinted" disabled onPress={() => undefined} />
        )}
      </ActionBar>
    </View>
  );
}
