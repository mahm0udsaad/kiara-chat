import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { PLAYBACK_AUDIO_MODE } from "@/components/inbox/media-attachment";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ActionBar, PrimaryButton } from "@/components/primary-button";
import { ServiceTimingCard } from "@/components/orders/service-timing-card";
import { ErrorState, InlineAlert, LoadingScreen } from "@/components/screen-state";
import { Badge } from "@/components/ui/badge";
import { Card, Divider } from "@/components/ui/card";
import { DetailRow, SectionHeader } from "@/components/ui/detail-row";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { Segmented } from "@/components/ui/segmented";
import { hitSize, radius, rtlText, spacing, type } from "@/constants/theme";
import {
  formatPhone,
  locationLabel,
  locationUrl,
} from "@/lib/format";
import { useFieldI18n } from "@/lib/field-i18n";
import { successFeedback } from "@/lib/haptics";
import { useKeyboardPadding } from "@/lib/keyboard";
import { useCancelAcceptedFieldOrder, useFieldOrder, useFieldOrderAction, useSubmitLateReason } from "@/lib/queries";
import { useDriverTripTracking } from "@/lib/driver-trip-tracking";
import { useTheme } from "@/providers/theme-provider";
import type { FieldOrder, LateReasonCode, PunctualitySummary } from "@/types/api";

const CLASSIFICATION_LABEL: Record<PunctualitySummary["classification"], string> = {
  pending: "الرحلة قيد المتابعة",
  on_time: "وصلت الرحلة في الموعد",
  driver_late_to_specialist: "تأخر السائق في الوصول للأخصائية",
  specialist_delayed_departure: "تأخر الانطلاق بعد وصول السائق",
  driver_trip_late_to_client: "تأخرت الرحلة في الوصول للعميلة",
  uncertain: "المسؤولية غير مؤكدة",
};

const REASON_OPTIONS: { code: LateReasonCode; label: string }[] = [
  { code: "traffic", label: "ازدحام مروري" },
  { code: "specialist_not_ready", label: "الأخصائية لم تكن جاهزة" },
  { code: "incorrect_specialist_location", label: "موقع الأخصائية غير صحيح" },
  { code: "incorrect_client_location", label: "موقع العميلة غير صحيح" },
  { code: "vehicle_issue", label: "مشكلة في السيارة" },
  { code: "previous_order_finished_late", label: "انتهى الطلب السابق متأخرًا" },
  { code: "other", label: "سبب آخر" },
];

function PunctualityCard({ value, onReason }: { value: PunctualitySummary; onReason: () => void }) {
  const { colors } = useTheme();
  const milestones = [
    [value.specialistArrivalSource === "driver_step" ? "وصول السائق للأخصائية (حسب تأكيده)" : "وصول السائق للأخصائية", value.plannedSpecialistArrivalAt, value.specialistArrivedAt],
    ["انطلاق السائق", value.plannedDriverDepartureAt, value.driverDepartedAt],
    ["ركوب الأخصائية", null, value.specialistPickupAt],
    [value.clientArrivalSource === "service_start" ? "الوصول للعميلة (حسب بدء الخدمة)" : "الوصول للعميلة", null, value.clientArrivedAt],
    ["بدء الخدمة", null, value.serviceStartedAt],
  ] as const;
  const time = (iso: string | null) => iso ? new Intl.DateTimeFormat("ar-SA", { hour: "numeric", minute: "2-digit" }).format(new Date(iso)) : "—";
  return (
    <View style={{ gap: spacing.sm }}>
      <SectionHeader title="الالتزام بالمواعيد" />
      <Card style={{ gap: spacing.md }}>
        <Badge
          label={CLASSIFICATION_LABEL[value.classification]}
          tone={value.classification === "on_time" ? "success" : value.requiresLateReason ? "danger" : "warning"}
          icon={value.classification === "on_time" ? "checkmark.circle" : "clock"}
        />
        {value.specialistClientDistanceMetres !== null ? (
          <Text selectable style={{ ...type.footnote, color: colors.textSecondary, ...rtlText }}>
            إلى العميلة: {(value.specialistClientDistanceMetres / 1000).toFixed(1)} كم · نحو {Math.ceil((value.specialistClientDurationSeconds ?? 0) / 60)} د · {value.routeSource === "osrm" ? "مسار OSRM" : "تقدير احتياطي"}
          </Text>
        ) : null}
        {milestones.map(([label, planned, actual]) => (
          <View key={label} style={{ flexDirection: "row-reverse", justifyContent: "space-between", gap: spacing.sm }}>
            <Text selectable style={{ flex: 1, ...type.footnote, color: colors.text, ...rtlText }}>{label}</Text>
            <Text selectable style={{ ...type.caption, color: colors.textSecondary, fontVariant: ["tabular-nums"] }}>
              {planned ? `مخطط ${time(planned)} · ` : ""}فعلي {time(actual)}
            </Text>
          </View>
        ))}
        <Text selectable style={{ ...type.caption, color: colors.textTertiary, ...rtlText }}>
          حد الموقع {value.geofenceMetres} م · سماح {value.graceMinutes} د · آخر موقع {value.locationFreshnessSeconds === null ? "غير متاح" : `منذ ${value.locationFreshnessSeconds} ث`}
        </Text>
        {value.lateReasonCode ? (
          <Text selectable style={{ ...type.footnote, color: colors.textSecondary, ...rtlText }}>
            السبب: {REASON_OPTIONS.find((item) => item.code === value.lateReasonCode)?.label} — {value.lateReasonNote}
          </Text>
        ) : value.requiresLateReason ? (
          <PrimaryButton label="إضافة سبب التأخير" icon="exclamationmark.circle" tone="danger" variant="tinted" onPress={onReason} />
        ) : null}
      </Card>
    </View>
  );
}

function ProgressRail({ order }: { order: FieldOrder }) {
  const { colors } = useTheme();
  const { rowDirection, t } = useFieldI18n();
  const stepLabels = [
    t("stepConfirmRide"),
    t("stepDriverArrived"),
    t("stepPickup"),
    t("stepStartService"),
    t("stepCompleteService"),
    t("stepDriverReturn"),
  ];
  const done = [
    Boolean(order.progress.driverConfirmedAt),
    Boolean(order.progress.driverArrivedAt),
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
            // Six steps share one row, so a translated label can be several
            // words: let it wrap and shrink a little rather than end in "…".
            numberOfLines={3}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
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
        onPress={() => {
          if (status.playing) return player.pause();
          // Without the full mode iOS mutes playback on the silent switch.
          void setAudioModeAsync(PLAYBACK_AUDIO_MODE)
            .catch(() => {})
            .then(() => player.play());
        }}
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
  const keyboard = useKeyboardPadding();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = useMemo(() => (Array.isArray(params.id) ? params.id[0] ?? "" : params.id ?? ""), [params.id]);
  const detail = useFieldOrder(id);
  const action = useFieldOrderAction(id);
  const cancelAction = useCancelAcceptedFieldOrder(id);
  const reasonAction = useSubmitLateReason(id);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [completionOpen, setCompletionOpen] = useState(false);
  const [completionOutcome, setCompletionOutcome] = useState<"done" | "not_done">("done");
  const [completionNote, setCompletionNote] = useState("");
  const [lateReasonOpen, setLateReasonOpen] = useState(false);
  const [lateReasonCode, setLateReasonCode] = useState<LateReasonCode | null>(null);
  const [lateReasonNote, setLateReasonNote] = useState("");
  const { refetch: refetchDetail } = detail;
  const refreshAfterLocation = useCallback(() => { void refetchDetail(); }, [refetchDetail]);
  const viewer = detail.data?.order;
  useDriverTripTracking(
    id,
    // Unknown until loaded; a specialist's screen never touches the service.
    !viewer || viewer.viewerRole !== "driver" ? null : Boolean(viewer.punctuality?.trackingActive),
    refreshAfterLocation,
  );
  if (detail.isLoading) return <LoadingScreen label={t("loadingOrder")} />;
  if (detail.isError || !detail.data) {
    return <ErrorState title={t("orderLoadError")} message={detail.error ? t("orderLoadError") : t("orderNotFound")} onRetry={() => void detail.refetch()} />;
  }
  const order = detail.data.order;
  const cancelled = order.status === "cancelled";
  const next = order.nextAction;
  const confirm = () => {
    if (!next) return;
    if (next === "complete_order") {
      setCompletionOpen(true);
      return;
    }
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
  const closeCompletion = () => {
    if (action.isPending) return;
    setCompletionOpen(false);
    setCompletionOutcome("done");
    setCompletionNote("");
    action.reset();
  };
  const submitCompletion = () => {
    action.mutate(
      {
        action: "complete_order",
        expectedVersion: order.progress.version,
        completionOutcome,
        completionNote,
      },
      {
        onSuccess: () => {
          successFeedback();
          setCompletionOpen(false);
          setCompletionOutcome("done");
          setCompletionNote("");
        },
      },
    );
  };
  const closeCancel = () => {
    if (cancelAction.isPending) return;
    setCancelOpen(false);
    setCancelReason("");
    cancelAction.reset();
  };
  const customer = order.customerName || "العميلة";
  const trimmedCancelReason = cancelReason.trim();
  const cancellationNotification = `ألغى السائق طلب ${customer}. السبب: ${trimmedCancelReason || "سبب الإلغاء"}`;
  const submitCancellation = () => {
    if (trimmedCancelReason.length < 3) return;
    cancelAction.mutate(
      { reason: trimmedCancelReason, expectedVersion: order.progress.version },
      {
        onSuccess: () => {
          successFeedback();
          setCancelOpen(false);
          setCancelReason("");
        },
      },
    );
  };
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
              label={cancelled ? t("cancelledBadge") : order.progress.driverReturnedAt ? t("completed") : order.canAct ? t("waitingForYou") : t("waitingNextStep")}
              tone={cancelled ? "danger" : order.progress.driverReturnedAt ? "success" : order.canAct ? "warning" : "neutral"}
              icon={cancelled ? "xmark.circle" : order.progress.driverReturnedAt ? "checkmark.circle" : "clock"}
            />
          </View>
          <Divider />
          <ProgressRail order={order} />
        </Card>

        <ServiceTimingCard
          scheduledAt={order.arrivalAt}
          serviceStartedAt={order.progress.serviceStartedAt}
        />

        <View style={{ gap: spacing.sm }}>
          <SectionHeader title={t("servicesSection")} />
          <Card style={{ gap: spacing.md }}>
            {order.services?.length ? (
              order.services.map((service, index) => (
                <View
                  key={service.id}
                  style={{ flexDirection: rowDirection, alignItems: "center", gap: spacing.sm }}
                >
                  <View
                    style={{
                      width: 28,
                      height: 28,
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: radius.full,
                      backgroundColor: colors.brandSoft,
                    }}
                  >
                    <Text style={{ ...type.footnote, color: colors.onBrandSoft }}>{index + 1}</Text>
                  </View>
                  <Text selectable style={{ flex: 1, ...type.body, color: colors.text, ...textStyle }}>
                    {service.name}
                  </Text>
                  <Text style={{ ...type.footnote, color: colors.textSecondary, ...textStyle }}>
                    {duration(service.minutes)}
                  </Text>
                </View>
              ))
            ) : (
              <Text style={{ ...type.body, color: colors.textSecondary, ...textStyle }}>
                {t("noServices")}
              </Text>
            )}
          </Card>
        </View>

        {order.progress.completedAt ? (
          <View style={{ gap: spacing.sm }}>
            <SectionHeader title={t("completionResultTitle")} />
            <Card style={{ gap: spacing.sm }}>
              <Badge
                label={
                  order.progress.completionOutcome === "not_done"
                    ? t("notCompleted")
                    : t("completedAsPlanned")
                }
                tone={order.progress.completionOutcome === "not_done" ? "danger" : "success"}
                icon={order.progress.completionOutcome === "not_done" ? "xmark.circle" : "checkmark.circle"}
              />
              {order.progress.completionNote ? (
                <Text selectable style={{ ...type.body, color: colors.text, ...textStyle }}>
                  {order.progress.completionNote}
                </Text>
              ) : null}
            </Card>
          </View>
        ) : null}

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

        {/* Null for orders from before tracking started, or without both pins. */}
        {order.punctuality ? (
          <PunctualityCard value={order.punctuality} onReason={() => setLateReasonOpen(true)} />
        ) : null}

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
        {order.canCancel ? (
          <PrimaryButton
            label="إلغاء الطلب"
            icon="xmark.circle"
            tone="danger"
            variant="outline"
            disabled={action.isPending}
            onPress={() => setCancelOpen(true)}
          />
        ) : null}
        {cancelled ? (
          <PrimaryButton label={t("orderCancelled")} icon="xmark.circle" tone="danger" variant="tinted" disabled onPress={() => undefined} />
        ) : next && order.canAct ? (
          <PrimaryButton label={actionLabel(next)} icon="checkmark.circle" loading={action.isPending} onPress={confirm} />
        ) : next ? (
          <PrimaryButton label={actionLabel(next)} icon="hourglass" variant="tinted" disabled onPress={() => undefined} />
        ) : (
          <PrimaryButton label={t("orderFinished")} icon="checkmark.circle" tone="success" variant="tinted" disabled onPress={() => undefined} />
        )}
      </ActionBar>

      <Modal
        visible={completionOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeCompletion}
      >
        <KeyboardAvoidingView
          behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined}
          onLayout={keyboard.onLayout}
          style={{ flex: 1, backgroundColor: colors.background, paddingBottom: keyboard.paddingBottom }}
        >
          <View
            style={{
              flexDirection: rowDirection,
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: spacing.lg,
              paddingVertical: spacing.md,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
              backgroundColor: colors.surface,
            }}
          >
            <Text style={{ ...type.title3, color: colors.text, ...textStyle }}>
              {t("completionResultTitle")}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("cancel")}
              disabled={action.isPending}
              onPress={closeCompletion}
              style={({ pressed }) => ({
                width: hitSize.min,
                height: hitSize.min,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: radius.full,
                backgroundColor: colors.surfaceSunken,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <IconSymbol name="xmark" color={colors.textSecondary} size={18} />
            </Pressable>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing["3xl"] }}
          >
            <View style={{ gap: spacing.xs }}>
              <Text style={{ ...type.title2, color: colors.text, ...textStyle }}>
                {t("completionResultTitle")}
              </Text>
              <Text style={{ ...type.body, color: colors.textSecondary, ...textStyle }}>
                {t("completionResultBody")}
              </Text>
            </View>
            <Segmented
              options={[
                { value: "done", label: t("completedAsPlanned") },
                { value: "not_done", label: t("notCompleted") },
              ]}
              value={completionOutcome}
              onChange={setCompletionOutcome}
              accessibilityLabel={t("completionResultTitle")}
            />
            <View style={{ gap: spacing.sm }}>
              <Text style={{ ...type.calloutStrong, color: colors.text, ...textStyle }}>
                {t("completionNoteLabel")}
              </Text>
              <TextInput
                multiline
                maxLength={500}
                value={completionNote}
                onChangeText={setCompletionNote}
                editable={!action.isPending}
                placeholder={t("completionNotePlaceholder")}
                placeholderTextColor={colors.textTertiary}
                accessibilityLabel={t("completionNoteLabel")}
                style={{
                  minHeight: 120,
                  padding: spacing.md,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: colors.borderStrong,
                  backgroundColor: colors.surface,
                  color: colors.text,
                  ...type.body,
                  ...textStyle,
                  textAlignVertical: "top",
                }}
              />
              <Text style={{ ...type.caption, color: colors.textTertiary, fontVariant: ["tabular-nums"] }}>
                {completionNote.length}/500
              </Text>
            </View>
            {action.error ? <InlineAlert message={t("actionFailed")} /> : null}
            <PrimaryButton
              label={t("confirmCompletion")}
              icon="checkmark.circle"
              tone={completionOutcome === "not_done" ? "danger" : "success"}
              loading={action.isPending}
              onPress={submitCompletion}
            />
            <PrimaryButton
              label={t("cancel")}
              variant="plain"
              disabled={action.isPending}
              onPress={closeCompletion}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={cancelOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeCancel}
      >
        <KeyboardAvoidingView
          behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined}
          onLayout={keyboard.onLayout}
          style={{ flex: 1, backgroundColor: colors.background, paddingBottom: keyboard.paddingBottom }}
        >
          <View
            style={{
              flexDirection: "row-reverse",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: spacing.lg,
              paddingVertical: spacing.md,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
              backgroundColor: colors.surface,
            }}
          >
            <Text style={{ ...type.title3, color: colors.text, ...rtlText }}>إلغاء الطلب</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="إغلاق"
              disabled={cancelAction.isPending}
              onPress={closeCancel}
              style={({ pressed }) => ({
                width: hitSize.min,
                height: hitSize.min,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: radius.full,
                backgroundColor: colors.surfaceSunken,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <IconSymbol name="xmark" color={colors.textSecondary} size={18} />
            </Pressable>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing["3xl"] }}
          >
            <View style={{ gap: spacing.xs }}>
              <Text style={{ ...type.title2, color: colors.text, ...rtlText }}>لماذا تريد إلغاء الطلب؟</Text>
              <Text style={{ ...type.body, color: colors.textSecondary, ...rtlText }}>
                الإلغاء متاح الآن فقط، قبل أن تؤكد الأخصائية ركوبها معك.
              </Text>
            </View>
            <View style={{ gap: spacing.sm }}>
              <Text style={{ ...type.calloutStrong, color: colors.text, ...rtlText }}>سبب الإلغاء</Text>
              <TextInput
                autoFocus
                multiline
                maxLength={500}
                value={cancelReason}
                onChangeText={setCancelReason}
                editable={!cancelAction.isPending}
                placeholder="مثال: عطل في السيارة"
                placeholderTextColor={colors.textTertiary}
                accessibilityLabel="سبب إلغاء الطلب"
                style={{
                  minHeight: 120,
                  padding: spacing.md,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: colors.borderStrong,
                  backgroundColor: colors.surface,
                  color: colors.text,
                  ...type.body,
                  ...rtlText,
                  textAlignVertical: "top",
                }}
              />
              {cancelReason.length > 0 && trimmedCancelReason.length < 3 ? (
                <Text style={{ ...type.footnote, color: colors.danger, ...rtlText }}>اكتب 3 أحرف على الأقل.</Text>
              ) : null}
            </View>
            <View style={{ gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.dangerSoft }}>
              <Text style={{ ...type.calloutStrong, color: colors.onDangerSoft, ...rtlText }}>سيصل للفريق هذا التنبيه:</Text>
              <Text selectable style={{ ...type.body, color: colors.onDangerSoft, ...rtlText }}>
                إلغاء الطلب{"\n"}{cancellationNotification}
              </Text>
            </View>
            {cancelAction.error ? <InlineAlert message="تعذر إلغاء الطلب. حدّث الصفحة وتأكد أن الأخصائية لم تبدأ الاستلام." /> : null}
            <PrimaryButton
              label="تأكيد إلغاء الطلب"
              loadingLabel="جارٍ إلغاء الطلب…"
              icon="xmark.circle"
              tone="danger"
              loading={cancelAction.isPending}
              disabled={trimmedCancelReason.length < 3}
              onPress={submitCancellation}
            />
            <PrimaryButton label="العودة بدون إلغاء" variant="plain" disabled={cancelAction.isPending} onPress={closeCancel} />
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={lateReasonOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setLateReasonOpen(false)}>
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }} style={{ backgroundColor: colors.background }}>
          <Text selectable style={{ ...type.title2, color: colors.text, ...rtlText }}>سبب التأخير</Text>
          <Text selectable style={{ ...type.body, color: colors.textSecondary, ...rtlText }}>اختاري سببًا محددًا، ثم اكتبي ملاحظة تساعد العمليات على فهم ما حدث.</Text>
          <View style={{ gap: spacing.sm }}>
            {REASON_OPTIONS.map((item) => (
              <Pressable key={item.code} onPress={() => setLateReasonCode(item.code)} style={({ pressed }) => ({ padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: lateReasonCode === item.code ? colors.brand : colors.borderStrong, backgroundColor: lateReasonCode === item.code ? colors.brandSoft : colors.surface, opacity: pressed ? 0.7 : 1 })}>
                <Text selectable style={{ ...type.body, color: colors.text, ...rtlText }}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput multiline maxLength={500} value={lateReasonNote} onChangeText={setLateReasonNote} placeholder="اكتبي التفاصيل (3 أحرف على الأقل)" placeholderTextColor={colors.textTertiary} style={{ minHeight: 120, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, color: colors.text, ...type.body, ...rtlText, textAlignVertical: "top" }} />
          {reasonAction.error ? <InlineAlert message="تعذر حفظ سبب التأخير." /> : null}
          <PrimaryButton label="حفظ سبب التأخير" icon="checkmark.circle" loading={reasonAction.isPending} disabled={!lateReasonCode || lateReasonNote.trim().length < 3} onPress={() => lateReasonCode && reasonAction.mutate({ code: lateReasonCode, note: lateReasonNote.trim() }, { onSuccess: () => { successFeedback(); setLateReasonOpen(false); setLateReasonCode(null); setLateReasonNote(""); } })} />
          <PrimaryButton label="إلغاء" variant="plain" disabled={reasonAction.isPending} onPress={() => setLateReasonOpen(false)} />
        </ScrollView>
      </Modal>
    </View>
  );
}
