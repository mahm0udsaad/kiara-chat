import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import * as ImagePicker from "expo-image-picker";
import {
  AccessibilityInfo,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  type LayoutChangeEvent,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiError } from "@/lib/api";
import {
  DispatchVoiceNote,
  type VoiceNote,
} from "@/components/dispatch-voice-note";
import { ActionBar, PrimaryButton } from "@/components/primary-button";
import { RosterPicker } from "@/components/roster-picker";
import { ErrorState, InlineAlert, LoadingScreen } from "@/components/screen-state";
import { Card } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { Field, TextAreaField } from "@/components/ui/field";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { hitSize, radius, rtlText, spacing, type } from "@/constants/theme";
import {
  durationLabel,
  formatters,
  isLocationMissing,
  locationLabel,
  relativeDayLabel,
  tripTypeLabel,
} from "@/lib/format";
import {
  errorFeedback,
  successFeedback,
  tapFeedback,
  warningFeedback,
} from "@/lib/haptics";
import {
  useDispatchOptions,
  useDispatchOrder,
  useDispatchPreview,
  useOrder,
} from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";

const noteMaxLength = 500;
/** Matches the API's cap — a door photo is a snapshot, not an album. */
const MAX_DOOR_PHOTO_BYTES = 8 * 1024 * 1024;

/** Starters that cover the notes operators write most often. */
const noteTemplates = [
  "يرجى الوصول قبل الموعد بعشر دقائق.",
  "الجلسة تنظيف بشرة كامل.",
  "العميلة تفضّل الهدوء أثناء الجلسة.",
  "يرجى إحضار الأدوات الإضافية.",
];

/** How the send ended. Both states are terminal: the order is already out. */
type Outcome = "sent" | "already";
type ValidationField =
  | "location"
  | "specialist"
  | "driver"
  | "note"
  | "voiceNote"
  | "driverMessage"
  | "specialistMessage";
type ValidationError = { field: ValidationField; message: string };

/**
 * Arabic for the failures this screen can hit.
 *
 * The API answers in English, and its text used to be printed verbatim at the
 * bottom of a scroll view the employee never reaches — so a refused send read
 * exactly like a successful one. Every case she can act on gets a sentence
 * telling her whether the order went out and what to do next.
 */
function failureMessage(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return error instanceof Error && error.message
      ? error.message
      : "تعذر إكمال الإرسال. حاولي مرة أخرى.";
  }
  if (error.code === "ORDER_ALREADY_DISPATCHED") {
    return "هذا الطلب أُرسل بالفعل.";
  }
  if (error.status === 409) {
    return "الطلب تغيّر أو زميلة أخرى ترسله الآن. ارجعي وحدّثي صفحة الطلب قبل المحاولة.";
  }
  if (error.status >= 500 || error.status === 0) {
    return `${error.message} لم يتأكد إرسال الرسائل — راجعي صفحة الطلب قبل إعادة المحاولة.`;
  }
  return error.message;
}

function SummaryLine({ icon, text }: { icon: "calendar" | "clock" | "mappin.and.ellipse" | "car"; text: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row-reverse", alignItems: "flex-start", gap: spacing.sm }}>
      <IconSymbol name={icon} color={colors.textTertiary} size={15} />
      <Text selectable style={{ flex: 1, ...type.footnote, color: colors.textSecondary, ...rtlText }}>
        {text}
      </Text>
    </View>
  );
}

/**
 * The end of the flow, in place of the form. Both cases mean the messages are
 * out and there is nothing left to send, so the only action is leaving.
 */
function OutcomeScreen({ kind, sentAt }: { kind: Outcome; sentAt: string | null }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const sent = kind === "sent";

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
      >
        <Card>
          <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}>
            <IconSymbol
              name={sent ? "checkmark.circle" : "exclamationmark.triangle"}
              color={sent ? colors.success : colors.warning}
              size={26}
            />
            <Text style={{ flex: 1, ...type.headline, color: colors.text, ...rtlText }}>
              {sent ? "تم إسناد الطلب" : "هذا الطلب مُسند من قبل"}
            </Text>
          </View>
          <Text style={{ ...type.footnote, color: colors.textSecondary, ...rtlText }}>
            {sent
              ? "الطلب وملاحظاته ظاهران الآن في تطبيق السائق والأخصائية، ووصلهما تنبيه على التطبيق."
              : "الطلب أُسند سابقًا ولم يتغير شيء الآن. إذا لم ينتبها له، استخدمي إعادة الإرسال من صفحة الطلب."}
          </Text>
          {sentAt ? (
            <SummaryLine
              icon="calendar"
              text={`وقت الإرسال: ${formatters.dateTime.format(new Date(sentAt))}`}
            />
          ) : null}
        </Card>
      </ScrollView>

      <ActionBar bottomInset={insets.bottom}>
        <PrimaryButton
          label="العودة إلى الطلب"
          icon="chevron.right"
          tone={sent ? "success" : "brand"}
          silent
          onPress={() => router.back()}
          testID="dispatch-outcome-back"
        />
      </ActionBar>
    </View>
  );
}

function DispatchForm({ id }: { id: string }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const order = useOrder(id);
  const options = useDispatchOptions();
  const dispatch = useDispatchOrder(id);
  const preparePreview = useDispatchPreview(id);

  // The address is the first thing this form settles. A ركاز booking arrives
  // with the placeholder, which must not be offered as a value she can leave
  // alone — she starts from an empty box in that case.
  const [customerLocation, setCustomerLocation] = useState<string | null>(null);
  // Optional, and not remembered across orders: a door belongs to one address.
  const [doorPhoto, setDoorPhoto] = useState<
    { uri: string; name: string; type: string } | null
  >(null);
  const [doorPhotoError, setDoorPhotoError] = useState<string | null>(null);
  const [specialistId, setSpecialistId] = useState<string | null>(null);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  /**
   * Typed instructions or spoken ones. A recording is sent as its own WhatsApp
   * voice note after the booking copy, and replaces the written note rather
   * than adding to it — the specialist gets one instruction, in one form.
   */
  const [noteMode, setNoteMode] = useState<"text" | "voice">("text");
  const [voiceNote, setVoiceNote] = useState<VoiceNote | null>(null);
  const [validation, setValidation] = useState<ValidationError | null>(null);
  const [driverMessage, setDriverMessage] = useState("");
  const [specialistMessage, setSpecialistMessage] = useState("");
  const [specialistLanguage, setSpecialistLanguage] = useState("العربية");
  const [automaticAdditions, setAutomaticAdditions] = useState<string[]>([]);
  const [reviewing, setReviewing] = useState(false);
  /**
   * What the last attempt actually did. The screen used to close itself on
   * success and stay put on failure, so the employee had no way to tell a sent
   * order from a refused one — and no answer at all when she tried again.
   */
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  /**
   * A failure she can still act on, pinned above the buttons. Anything written
   * into the scroll view sits under two long message fields and never gets
   * read.
   */
  const [sendError, setSendError] = useState<string | null>(null);
  const initializedAssignments = useRef(false);
  const scrollViewRef = useRef<ScrollView>(null);
  const [fieldOffsets, setFieldOffsets] = useState<
    Partial<Record<ValidationField, number>>
  >({});

  useEffect(() => {
    if (!initializedAssignments.current && order.data) {
      setSpecialistId(order.data.order.specialist_id);
      setDriverId(order.data.order.driver_id);
      initializedAssignments.current = true;
    }
  }, [order.data]);

  if (order.isLoading || options.isLoading) return <LoadingScreen label="جارٍ تجهيز التأكيد…" />;
  if (order.isError || options.isError || !order.data || !options.data) {
    return (
      <ErrorState
        message={order.error?.message || options.error?.message || "تعذر تحميل الطلب"}
        onRetry={() => {
          void order.refetch();
          void options.refetch();
        }}
      />
    );
  }

  const current = order.data.order;
  // Re-opening a dispatched order used to walk her back through the whole form
  // and fail on the last tap. It is settled before the first field is drawn.
  const finished: Outcome | null =
    outcome ?? (current.dispatch_state === "sent" || current.sent_at ? "already" : null);
  if (finished) return <OutcomeScreen kind={finished} sentAt={current.sent_at} />;

  // Seeded from the order the first time through, blank when the order still
  // carries the placeholder.
  const location =
    customerLocation ??
    (isLocationMissing(current.customer_location) ? "" : current.customer_location);
  const locationMissing = isLocationMissing(location);
  const specialistName =
    options.data.specialists.find((person) => person.id === specialistId)?.full_name ?? null;
  const driverName =
    options.data.drivers.find((person) => person.id === driverId)?.full_name ?? null;

  const rememberFieldPosition =
    (field: ValidationField) => (event: LayoutChangeEvent) => {
      const y = event.nativeEvent.layout.y;
      setFieldOffsets((currentOffsets) =>
        currentOffsets[field] === y
          ? currentOffsets
          : { ...currentOffsets, [field]: y },
      );
    };

  const clearFieldError = (field: ValidationField) => {
    setValidation((currentError) =>
      currentError?.field === field ? null : currentError,
    );
  };

  /**
   * The action bar never moves, so an error can otherwise be painted well
   * above it without the operator seeing anything change. Keep the target
   * comfortably below the sheet header and announce the same actionable copy
   * to VoiceOver/TalkBack.
   */
  const showFieldError = (field: ValidationField, message: string) => {
    Keyboard.dismiss();
    setSendError(null);
    setValidation({ field, message });
    errorFeedback();
    AccessibilityInfo.announceForAccessibility(message);
    requestAnimationFrame(() => {
      const y = fieldOffsets[field];
      if (y === undefined) return;
      scrollViewRef.current?.scrollTo({
        y: Math.max(0, y - spacing.md),
        animated: true,
      });
    });
  };

  const review = () => {
    if (locationMissing) return showFieldError("location", "حدّدي موقع العميلة أولًا.");
    if (!specialistId) return showFieldError("specialist", "اختاري الأخصائية.");
    if (!driverId) return showFieldError("driver", "اختاري السائق.");
    if (noteMode === "text" && !note.trim()) {
      return showFieldError("note", "اكتبي رسالة للأخصائية.");
    }
    if (noteMode === "voice" && !voiceNote) {
      return showFieldError(
        "voiceNote",
        "سجّلي الملاحظة الصوتية أو حوّلي إلى تعليمات مكتوبة.",
      );
    }
    setValidation(null);
    setSendError(null);
    warningFeedback();
    preparePreview.mutate(
      {
        specialistId,
        driverId,
        customerLocation: location.trim(),
        // The preview writes the booking copy in her language; in voice mode
        // there is no written note to fold into it.
        specialistNote: noteMode === "text" ? note.trim() : "",
        tripType: current.trip_type,
      },
      {
        onSuccess: ({ preview }) => {
          setDriverMessage(preview.driverMessage);
          setSpecialistMessage(preview.specialistMessage);
          setSpecialistLanguage(preview.specialistLanguage);
          setAutomaticAdditions(preview.automaticAdditions);
          setReviewing(true);
        },
        onError: (error) => {
          // A second attempt on an order that already went out lands here, and
          // "the order was already dispatched" is an answer, not an error to
          // retry — so it ends the screen instead of blaming the network.
          if (error instanceof ApiError && error.code === "ORDER_ALREADY_DISPATCHED") {
            warningFeedback();
            setOutcome("already");
            return;
          }
          errorFeedback();
          setSendError(failureMessage(error));
        },
      },
    );
  };

  /** Camera roll only: the employee is at a desk, not at the door. */
  const pickDoorPhoto = async () => {
    setDoorPhotoError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setDoorPhotoError("لا يوجد إذن للوصول إلى الصور. فعّليه من إعدادات الجهاز.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.85,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    if ((asset.fileSize ?? 0) > MAX_DOOR_PHOTO_BYTES) {
      setDoorPhotoError("الصورة أكبر من اللازم. اختاري صورة أصغر.");
      return;
    }
    setDoorPhoto({
      uri: asset.uri,
      name: asset.fileName || `door-${Date.now()}.jpg`,
      type: asset.mimeType || "image/jpeg",
    });
  };

  const send = () => {
    if (locationMissing) return showFieldError("location", "حدّدي موقع العميلة أولًا.");
    if (!specialistId) return showFieldError("specialist", "اختاري الأخصائية.");
    if (!driverId) return showFieldError("driver", "اختاري السائق.");
    if (!driverMessage.trim()) {
      return showFieldError("driverMessage", "راجعي رسالة السائق قبل الإرسال.");
    }
    if (!specialistMessage.trim()) {
      return showFieldError("specialistMessage", "راجعي رسالة الأخصائية قبل الإرسال.");
    }
    setValidation(null);
    setSendError(null);
    dispatch.mutate(
      {
        specialistId,
        driverId,
        customerLocation: location.trim(),
        driverMessage: driverMessage.trim(),
        specialistMessage: specialistMessage.trim(),
        specialistVoice:
          noteMode === "voice" && voiceNote
            ? {
                uri: voiceNote.uri,
                name: `dispatch-note-${Date.now()}.m4a`,
                type: "audio/mp4",
              }
            : null,
        doorPhoto,
        expectedVersion: current.version,
      },
      {
        // The order and its notes are stored before this answers, so the
        // dispatch itself cannot half-succeed any more. Only the notification
        // can miss — worth telling her, but never a failed dispatch: they will
        // both find the order in their app either way.
        onSuccess: ({ notified }) => {
          if (notified === false) {
            warningFeedback();
            setSendError(
              "تم إسناد الطلب، لكن لم يصل التنبيه لأي جهاز. تأكدي من تسجيل دخولهما للتطبيق.",
            );
            return;
          }
          successFeedback();
          // Not `router.back()`: closing the screen the instant it succeeds is
          // indistinguishable from closing it because the tap did nothing. She
          // reads the confirmation and leaves on her own.
          setSendError(null);
          setOutcome("sent");
        },
        onError: (error) => {
          if (error instanceof ApiError && error.code === "ORDER_ALREADY_DISPATCHED") {
            warningFeedback();
            setOutcome("already");
            return;
          }
          errorFeedback();
          setSendError(failureMessage(error));
        },
      },
    );
  };

  return (
    <KeyboardAvoidingView
      behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ScrollView
        ref={scrollViewRef}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{
          padding: spacing.lg,
          gap: spacing.xl,
          paddingBottom: spacing["3xl"],
        }}
      >
        {/* What is about to be sent — this action is irreversible, so the
            details stay on screen next to the confirm button. */}
        <Card>
          <Text selectable style={{ ...type.headline, color: colors.text, ...rtlText }}>
            {current.customer_name || current.customer_phone}
          </Text>
          <SummaryLine
            icon="calendar"
            text={`${relativeDayLabel(current.arrival_at)} · ${formatters.time.format(
              new Date(current.arrival_at),
            )}`}
          />
          <SummaryLine
            icon="clock"
            text={`${durationLabel(current.duration_minutes)} · ${tripTypeLabel[current.trip_type]}`}
          />
          <SummaryLine
            icon="mappin.and.ellipse"
            text={locationLabel(current.customer_location)}
          />
        </Card>

        {!reviewing ? (
          <>
            <InlineAlert
              tone="info"
              message="سننشئ الرسالة النهائية ونترجمها حسب جنسية الأخصائية، ثم ستراجعين النصين وتعدّلينهما قبل الإرسال."
            />

            {/* First, and gating the roster. A booking raised from ركاز carries
                no address, and the placeholder used to travel into the driver's
                instructions as though it were a place. */}
            <View onLayout={rememberFieldPosition("location")}>
              <Field
                label="موقع العميلة"
                icon="mappin.and.ellipse"
                value={location}
                onChangeText={(value) => {
                  setCustomerLocation(value);
                  clearFieldError("location");
                  setReviewing(false);
                }}
                maxLength={500}
                placeholder="الحي والشارع، أو رابط الموقع من واتساب"
                hint={
                  locationMissing
                    ? "لا يمكن اختيار الأخصائية والسائق قبل تحديد الموقع."
                    : "هذا هو العنوان الذي سيصل السائق إليه."
                }
                error={
                  validation?.field === "location" ? validation.message : null
                }
              />
            </View>

            {/* A pin puts the driver on the street; the photo tells him which
                gate. Optional — a missing one never holds up a dispatch. */}
            <View style={{ gap: spacing.sm }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={doorPhoto ? "تغيير صورة الباب" : "إضافة صورة باب العميلة"}
                onPress={pickDoorPhoto}
                style={({ pressed }) => ({
                  flexDirection: "row-reverse",
                  alignItems: "center",
                  gap: spacing.sm,
                  padding: spacing.md,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderStyle: "dashed",
                  borderColor: colors.borderStrong,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <IconSymbol name="camera" size={20} color={colors.textSecondary} />
                <Text style={{ flex: 1, ...type.footnote, color: colors.textSecondary, ...rtlText }}>
                  {doorPhoto
                    ? "صورة الباب مرفقة — اضغطي للتغيير"
                    : "صورة باب العميلة (اختياري)"}
                </Text>
                {doorPhoto ? (
                  <Image
                    source={{ uri: doorPhoto.uri }}
                    accessibilityLabel="معاينة صورة باب العميلة"
                    style={{ width: 44, height: 44, borderRadius: radius.sm }}
                  />
                ) : null}
              </Pressable>
              {doorPhoto ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setDoorPhoto(null);
                    setDoorPhotoError(null);
                  }}
                >
                  <Text style={{ ...type.footnote, color: colors.danger, ...rtlText }}>
                    إزالة الصورة
                  </Text>
                </Pressable>
              ) : null}
              {doorPhotoError ? <InlineAlert message={doorPhotoError} /> : null}
            </View>

            {locationMissing ? null : (
              <>
                <View onLayout={rememberFieldPosition("specialist")}>
                  <RosterPicker
                    label="الأخصائية"
                    options={options.data.specialists}
                    value={specialistId}
                    onChange={(value) => {
                      setSpecialistId(value);
                      clearFieldError("specialist");
                    }}
                    error={
                      validation?.field === "specialist"
                        ? validation.message
                        : null
                    }
                  />
                </View>
                <View onLayout={rememberFieldPosition("driver")}>
                  <RosterPicker
                    label="السائق"
                    options={options.data.drivers}
                    value={driverId}
                    onChange={(value) => {
                      setDriverId(value);
                      clearFieldError("driver");
                    }}
                    error={
                      validation?.field === "driver" ? validation.message : null
                    }
                  />
                </View>
              </>
            )}

            <View style={{ gap: spacing.sm }}>
              <Segmented
                accessibilityLabel="نوع تعليمات الأخصائية"
                value={noteMode}
                onChange={(value) => {
                  setNoteMode(value);
                  setValidation(null);
                }}
                testIDPrefix="dispatch-note-mode"
                options={[
                  { value: "text", label: "تعليمات مكتوبة" },
                  { value: "voice", label: "ملاحظة صوتية" },
                ]}
              />
            </View>

            {noteMode === "voice" ? (
              <View
                onLayout={rememberFieldPosition("voiceNote")}
                style={{
                  gap: spacing.sm,
                  padding: validation?.field === "voiceNote" ? spacing.md : 0,
                  borderRadius: radius.lg,
                  borderCurve: "continuous",
                  borderWidth: validation?.field === "voiceNote" ? 1.5 : 0,
                  borderColor: colors.danger,
                  backgroundColor:
                    validation?.field === "voiceNote"
                      ? colors.dangerSoft
                      : "transparent",
                }}
              >
                <DispatchVoiceNote
                  value={voiceNote}
                  onChange={(next) => {
                    setVoiceNote(next);
                    setSendError(null);
                    clearFieldError("voiceNote");
                  }}
                  disabled={dispatch.isPending}
                />
                {validation?.field === "voiceNote" ? (
                  <Text
                    selectable
                    accessibilityRole="alert"
                    style={{ ...type.footnote, color: colors.danger, ...rtlText }}
                  >
                    {validation.message}
                  </Text>
                ) : null}
                <Text style={{ ...type.footnote, color: colors.textTertiary, ...rtlText }}>
                  تفاصيل الحجز تظهر لها مكتوبة بلغتها، ويظهر التسجيل معها في
                  تطبيقها لتسمعه.
                </Text>
              </View>
            ) : (
              <View
                onLayout={rememberFieldPosition("note")}
                style={{ gap: spacing.sm }}
              >
                <TextAreaField
                  label="تعليمات الأخصائية بالعربية"
                  value={note}
                  onChangeText={(value) => {
                    setNote(value);
                    clearFieldError("note");
                  }}
                  maxLength={noteMaxLength}
                  placeholder="مثال: الجلسة تنظيف بشرة، يرجى الوصول قبل الموعد بعشر دقائق…"
                  error={validation?.field === "note" ? validation.message : null}
                />

                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: spacing.sm, paddingVertical: spacing.xs }}
                >
                  {noteTemplates.map((template) => (
                    <Pressable
                      key={template}
                      accessibilityRole="button"
                      accessibilityLabel={`إضافة: ${template}`}
                      onPress={() => {
                        tapFeedback();
                        setNote((current) => {
                          const next = current.trim() ? `${current.trim()} ${template}` : template;
                          return next.slice(0, noteMaxLength);
                        });
                        clearFieldError("note");
                      }}
                      style={({ pressed }) => ({
                        minHeight: hitSize.min,
                        justifyContent: "center",
                        paddingHorizontal: spacing.md + 2,
                        borderRadius: radius.full,
                        borderWidth: 1,
                        borderColor: colors.border,
                        backgroundColor: pressed ? colors.surfaceSunken : colors.surface,
                      })}
                    >
                      <Text style={{ ...type.footnote, color: colors.textSecondary, ...rtlText }}>
                        {template}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}
          </>
        ) : (
          <>
            <InlineAlert
              tone="warning"
              message={`هذه هي الرسائل النهائية إلى ${specialistName} و${driverName}. عدّلي أي نص الآن؛ سيُرسل الظاهر هنا حرفيًا.`}
            />
            <View onLayout={rememberFieldPosition("driverMessage")}>
              <TextAreaField
                label="رسالة السائق النهائية"
                value={driverMessage}
                onChangeText={(value) => {
                  setDriverMessage(value);
                  clearFieldError("driverMessage");
                }}
                maxLength={3_000}
                minHeight={180}
                error={
                  validation?.field === "driverMessage"
                    ? validation.message
                    : null
                }
              />
            </View>
            <View onLayout={rememberFieldPosition("specialistMessage")}>
              <TextAreaField
                label={`رسالة الأخصائية النهائية · ${specialistLanguage}`}
                value={specialistMessage}
                onChangeText={(value) => {
                  setSpecialistMessage(value);
                  clearFieldError("specialistMessage");
                }}
                maxLength={3_000}
                minHeight={220}
                error={
                  validation?.field === "specialistMessage"
                    ? validation.message
                    : null
                }
              />
            </View>
            {noteMode === "voice" && voiceNote ? (
              <InlineAlert
                tone="info"
                message="ستصل الملاحظة الصوتية إلى الأخصائية كرسالة مستقلة بعد النص أعلاه."
              />
            ) : null}
            <Card>
              <Text selectable style={{ ...type.subheadStrong, color: colors.text, ...rtlText }}>
                إضافات التطبيق الظاهرة قبل التأكيد
              </Text>
              {automaticAdditions.map((addition) => (
                <Text
                  selectable
                  key={addition}
                  style={{ ...type.footnote, color: colors.textSecondary, ...rtlText }}
                >
                  {addition}
                </Text>
              ))}
            </Card>
          </>
        )}

      </ScrollView>

      <ActionBar bottomInset={insets.bottom}>
        {/* Above the buttons, not inside the scroll view: this is the answer to
            the tap she just made, and she is looking at the button. */}
        {sendError ? <InlineAlert message={sendError} /> : null}
        {reviewing ? (
          <>
            <PrimaryButton
              label="تأكيد وإرسال الرسالتين"
              icon="paperplane.fill"
              loading={dispatch.isPending}
              loadingLabel="جاري الإرسال…"
              onPress={send}
              testID="dispatch-confirm-send"
            />
            <PrimaryButton
              label="رجوع للتعديل"
              icon="chevron.right"
              variant="plain"
              disabled={dispatch.isPending}
              onPress={() => {
                setReviewing(false);
                setValidation(null);
              }}
            />
          </>
        ) : (
          <PrimaryButton
            label="إنشاء الرسائل ومراجعتها"
            icon="sparkles"
            loading={preparePreview.isPending}
            loadingLabel="جاري تجهيز الرسائل…"
            onPress={review}
            testID="dispatch-generate-preview"
          />
        )}
      </ActionBar>
    </KeyboardAvoidingView>
  );
}

export default function DispatchOrderScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = useMemo(
    () => (Array.isArray(params.id) ? (params.id[0] ?? "") : (params.id ?? "")),
    [params.id],
  );
  return <DispatchForm id={id} />;
}
