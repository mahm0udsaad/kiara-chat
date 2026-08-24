import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
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
import { InlineAlert } from "@/components/screen-state";
import { TextAreaField } from "@/components/ui/field";
import { IconSymbol, type IconName } from "@/components/ui/icon-symbol";
import { Segmented } from "@/components/ui/segmented";
import { hitSize, radius, rtlText, spacing, type } from "@/constants/theme";
import {
  durationLabel,
  formatters,
  relativeDayLabel,
  relativeTimeLabel,
  tripTypeLabel,
} from "@/lib/format";
import { successFeedback, tapFeedback } from "@/lib/haptics";
import { useCreateConversationOrder } from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";
import type { BookingRequest, SharedLocation, TripType } from "@/types/api";

const minDurationHours = 0.5;
const maxDurationHours = 8;
/** The stepper's grain — half an hour is how sessions are actually sold. */
const durationStepHours = 0.5;

/** Arabic-Indic digits and the Arabic decimal mark, as they arrive from the keyboard. */
function normalizeNumeric(input: string): string {
  return input
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٫,]/g, ".");
}

/** "1"، "1.5" — never "1.0", which reads like a machine wrote it. */
function hoursText(hours: number): string {
  return String(Number(hours.toFixed(2)));
}

const SHARED_LABEL: Record<SharedLocation["source"], string> = {
  pin: "موقع أرسلته العميلة",
  link: "رابط خريطة من المحادثة",
  text: "آخر عنوان كتبته العميلة",
};

/** An hour from now, on the half hour, inside the working day. */
function roundedDefault(): Date {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  date.setMinutes(Math.ceil(date.getMinutes() / 30) * 30, 0, 0);
  if (date.getHours() < 8) {
    date.setHours(8, 0, 0, 0);
  } else if (date.getHours() > 22) {
    date.setDate(date.getDate() + 1);
    date.setHours(8, 0, 0, 0);
  }
  return date;
}

/**
 * What the location field opens with. A pin or a maps link she shared IS the
 * address, so it fills the field; a line she merely typed is a guess and stays
 * a suggestion to accept by hand.
 */
function initialLocation(
  booking: BookingRequest | null,
  shared: SharedLocation | null,
): string {
  return (
    (shared && shared.source !== "text" ? shared.value : "") ||
    booking?.location?.trim() ||
    ""
  );
}

/** Opens the customer's pin in whatever maps app the phone uses. */
function MapLink({ url }: { url: string }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel="فتح الموقع على الخريطة"
      onPress={() => {
        tapFeedback();
        void Linking.openURL(url).catch(() => {});
      }}
      hitSlop={spacing.sm}
      style={({ pressed }) => ({
        flexDirection: "row-reverse",
        alignItems: "center",
        gap: spacing.xs,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <IconSymbol name="mappin.and.ellipse" color={colors.brand} size={14} />
      <Text
        style={{
          ...type.footnote,
          fontWeight: "700",
          color: colors.brand,
          textDecorationLine: "underline",
          ...rtlText,
        }}
      >
        فتح على الخريطة
      </Text>
    </Pressable>
  );
}

function SheetHeader({ title, onClose }: { title: string; onClose: () => void }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row-reverse",
        alignItems: "center",
        justifyContent: "space-between",
        gap: spacing.md,
        paddingHorizontal: spacing.lg,
        paddingTop: spacing.lg,
        paddingBottom: spacing.md,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        backgroundColor: colors.surface,
      }}
    >
      <Text style={{ ...type.title3, color: colors.text, ...rtlText }}>{title}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="إغلاق"
        onPress={onClose}
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
  );
}

/** Row that reveals the native date/time picker in place when tapped. */
function PickerRow({
  icon,
  label,
  value,
  active,
  onPress,
}: {
  icon: IconName;
  label: string;
  value: string;
  active: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      accessibilityState={{ expanded: active }}
      onPress={() => {
        tapFeedback();
        onPress();
      }}
      style={({ pressed }) => ({
        minHeight: hitSize.control,
        flexDirection: "row-reverse",
        alignItems: "center",
        gap: spacing.md,
        paddingHorizontal: spacing.md + 2,
        borderRadius: radius.md,
        borderCurve: "continuous",
        borderWidth: active ? 1.5 : 1,
        borderColor: active ? colors.brand : colors.border,
        backgroundColor: pressed ? colors.surfaceSunken : colors.surface,
      })}
    >
      <IconSymbol name={icon} color={active ? colors.brand : colors.textTertiary} size={18} />
      <Text style={{ flex: 1, ...type.callout, color: colors.textSecondary, ...rtlText }}>
        {label}
      </Text>
      <Text
        style={{
          ...type.calloutStrong,
          color: active ? colors.brand : colors.text,
          fontVariant: ["tabular-nums"],
          ...rtlText,
        }}
      >
        {value}
      </Text>
    </Pressable>
  );
}

/**
 * تأكيد الحجز وطلب السائق — the phone's copy of the web inbox booking dialog.
 *
 * It saves the appointment only. Assigning the specialist and driver stays in
 * the dispatch screen, where the exact outbound WhatsApp text is reviewed, so
 * the sheet ends by offering that next step rather than sending anything.
 */
export function BookingSheet({
  open,
  onClose,
  conversationId,
  booking = null,
  sharedLocation = null,
}: {
  open: boolean;
  onClose: () => void;
  conversationId: string;
  booking?: BookingRequest | null;
  sharedLocation?: SharedLocation | null;
}) {
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const create = useCreateConversationOrder(conversationId);

  const [arrival, setArrival] = useState(roundedDefault);
  const [location, setLocation] = useState(() =>
    initialLocation(booking, sharedLocation),
  );
  // Held as text so the field can be cleared mid-typing. Sessions are booked
  // in hours here; the API takes minutes, and the conversion happens on submit.
  const [durationText, setDurationText] = useState("1");
  const [tripType, setTripType] = useState<TripType>("one_way");
  const [picker, setPicker] = useState<"date" | "time" | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const [createdOrderId, setCreatedOrderId] = useState<string | null>(null);

  // The sheet mounts with the conversation, long before it opens, so a pin that
  // lands in the meantime would otherwise be missed. Re-seed once per opening —
  // never while it is open, which would wipe what was typed.
  const seeded = useRef(false);
  const resetMutation = create.reset;
  const reset = useCallback(() => {
    setArrival(roundedDefault());
    setLocation(initialLocation(booking, sharedLocation));
    setDurationText("1");
    setTripType("one_way");
    setPicker(null);
    setValidation(null);
    setCreatedOrderId(null);
    resetMutation();
  }, [booking, sharedLocation, resetMutation]);

  useEffect(() => {
    if (!open) {
      seeded.current = false;
      return;
    }
    if (seeded.current) return;
    seeded.current = true;
    reset();
  }, [open, reset]);

  const close = () => {
    setPicker(null);
    onClose();
  };

  const onPickerChange = (event: DateTimePickerEvent, selected?: Date) => {
    // Android's picker is a dialog and reports its own dismissal.
    if (process.env.EXPO_OS !== "ios") setPicker(null);
    if (event.type === "dismissed" || !selected) return;
    setArrival(selected);
  };

  const durationHours = Number(normalizeNumeric(durationText));
  const durationValid =
    Number.isFinite(durationHours) &&
    durationHours >= minDurationHours &&
    durationHours <= maxDurationHours;
  const durationMinutes = durationValid ? Math.round(durationHours * 60) : 0;
  const durationError =
    durationText.trim() === "" || durationValid
      ? null
      : `مدة الجلسة يجب أن تكون بين نصف ساعة و${maxDurationHours} ساعات.`;

  const adjustDuration = (delta: number) => {
    tapFeedback();
    const base =
      Number.isFinite(durationHours) && durationHours > 0 ? durationHours : 1;
    setDurationText(
      hoursText(
        Math.min(maxDurationHours, Math.max(minDurationHours, base + delta)),
      ),
    );
  };

  const usingShared =
    Boolean(sharedLocation) && location.trim() === sharedLocation?.value.trim();

  const confirm = () => {
    if (!location.trim()) {
      setValidation("موقع العميلة مطلوب.");
      return;
    }
    if (!durationValid) return;
    setValidation(null);
    create.mutate(
      {
        arrivalAt: arrival.toISOString(),
        customerLocation: location.trim(),
        durationMinutes,
        tripType,
      },
      {
        onSuccess: (data) => {
          successFeedback();
          setCreatedOrderId(data.order.id);
        },
      },
    );
  };

  return (
    <Modal
      visible={open}
      onRequestClose={close}
      animationType="slide"
      presentationStyle="pageSheet"
    >
      <KeyboardAvoidingView
        // Inside a Modal, Android's windowSoftInputMode=adjustResize can't reach
        // this separate window, so — unlike the full-screen forms — the keyboard
        // has to be avoided in JS here.
        behavior={process.env.EXPO_OS === "ios" ? "padding" : "height"}
        style={{ flex: 1, backgroundColor: colors.background }}
      >
        <SheetHeader
          title={createdOrderId ? "تم إنشاء الحجز" : "تأكيد الحجز"}
          onClose={close}
        />

        {createdOrderId ? (
          <>
            <ScrollView
              contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
            >
              <View
                style={{
                  gap: spacing.sm,
                  padding: spacing.lg,
                  borderRadius: radius.lg,
                  borderCurve: "continuous",
                  backgroundColor: colors.successSoft,
                }}
              >
                <View
                  style={{
                    flexDirection: "row-reverse",
                    alignItems: "center",
                    gap: spacing.sm,
                  }}
                >
                  <IconSymbol
                    name="checkmark.circle"
                    color={colors.onSuccessSoft}
                    size={20}
                  />
                  <Text
                    style={{ ...type.headline, color: colors.onSuccessSoft, ...rtlText }}
                  >
                    الموعد محفوظ
                  </Text>
                </View>
                <Text
                  style={{ ...type.footnote, color: colors.onSuccessSoft, ...rtlText }}
                >
                  {formatters.fullDateTime.format(arrival)} ·{" "}
                  {durationLabel(durationMinutes)}
                </Text>
              </View>

              <Text style={{ ...type.callout, color: colors.textSecondary, ...rtlText }}>
                بقيت خطوة اختيار الأخصائية والسائق ومراجعة نص الرسالة قبل
                إرسالها.
              </Text>
            </ScrollView>

            <ActionBar bottomInset={insets.bottom}>
              <PrimaryButton
                label="طلب السائق الآن"
                icon="car"
                onPress={() => {
                  const id = createdOrderId;
                  close();
                  router.push({ pathname: "/orders/[id]/dispatch", params: { id } });
                }}
              />
              <PrimaryButton
                label="لاحقًا"
                variant="plain"
                silent
                onPress={close}
              />
            </ActionBar>
          </>
        ) : (
          <>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              contentContainerStyle={{
                padding: spacing.lg,
                gap: spacing.xl,
                paddingBottom: spacing["3xl"],
              }}
            >
              {booking ? (
                <View
                  style={{
                    gap: spacing.xs,
                    padding: spacing.md,
                    borderRadius: radius.lg,
                    borderCurve: "continuous",
                    backgroundColor: colors.brandSoft,
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row-reverse",
                      alignItems: "center",
                      gap: spacing.sm,
                    }}
                  >
                    <IconSymbol name="sparkles" color={colors.onBrandSoft} size={16} />
                    <Text
                      style={{
                        ...type.subheadStrong,
                        color: colors.onBrandSoft,
                        ...rtlText,
                      }}
                    >
                      تفاصيل جمعها المساعد
                    </Text>
                  </View>
                  <Text
                    selectable
                    style={{ ...type.footnote, color: colors.onBrandSoft, ...rtlText }}
                  >
                    {[booking.service, booking.time, booking.location]
                      .filter(Boolean)
                      .join(" · ") || booking.summary}
                  </Text>
                </View>
              ) : null}

              {/* Arrival */}
              <View style={{ gap: spacing.sm }}>
                <Text style={{ ...type.subheadStrong, color: colors.text, ...rtlText }}>
                  موعد الوصول
                </Text>
                <PickerRow
                  icon="calendar"
                  label="التاريخ"
                  value={relativeDayLabel(arrival.toISOString())}
                  active={picker === "date"}
                  onPress={() =>
                    setPicker((current) => (current === "date" ? null : "date"))
                  }
                />
                <PickerRow
                  icon="clock"
                  label="الوقت"
                  value={formatters.time.format(arrival)}
                  active={picker === "time"}
                  onPress={() =>
                    setPicker((current) => (current === "time" ? null : "time"))
                  }
                />
                {picker ? (
                  <View
                    style={{
                      borderRadius: radius.lg,
                      borderCurve: "continuous",
                      borderWidth: 1,
                      borderColor: colors.border,
                      backgroundColor: colors.surface,
                      overflow: "hidden",
                    }}
                  >
                    <DateTimePicker
                      value={arrival}
                      mode={picker}
                      display={process.env.EXPO_OS === "ios" ? "spinner" : "default"}
                      locale="ar"
                      themeVariant={scheme}
                      minimumDate={picker === "date" ? new Date() : undefined}
                      onChange={onPickerChange}
                    />
                  </View>
                ) : null}
                <Text style={{ ...type.footnote, color: colors.textTertiary, ...rtlText }}>
                  {formatters.fullDateTime.format(arrival)}
                </Text>
              </View>

              {/* Location */}
              <View style={{ gap: spacing.sm }}>
                <TextAreaField
                  label="موقع العميلة"
                  value={location}
                  onChangeText={setLocation}
                  minHeight={84}
                  placeholder="العنوان أو رابط الموقع على الخرائط"
                  error={validation}
                />
                {sharedLocation ? (
                  usingShared ? (
                    // Already in the field — say where it came from, and let
                    // her check it on the map before saving the booking.
                    <View
                      style={{
                        flexDirection: "row-reverse",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: spacing.sm,
                      }}
                    >
                      <IconSymbol
                        name="mappin.and.ellipse"
                        color={colors.brand}
                        size={14}
                      />
                      <Text style={{ ...type.footnote, color: colors.brand, ...rtlText }}>
                        {SHARED_LABEL[sharedLocation.source]} ·{" "}
                        {relativeTimeLabel(sharedLocation.at)}
                      </Text>
                      {sharedLocation.url ? <MapLink url={sharedLocation.url} /> : null}
                    </View>
                  ) : (
                    <View
                      style={{
                        gap: spacing.sm,
                        padding: spacing.md,
                        borderRadius: radius.md,
                        borderCurve: "continuous",
                        borderWidth: 1,
                        borderStyle: "dashed",
                        borderColor: colors.borderStrong,
                        backgroundColor: colors.surface,
                      }}
                    >
                      <View
                        style={{
                          flexDirection: "row-reverse",
                          alignItems: "flex-start",
                          gap: spacing.sm,
                        }}
                      >
                        <IconSymbol
                          name="mappin.and.ellipse"
                          color={colors.brand}
                          size={16}
                        />
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text
                            style={{
                              ...type.subheadStrong,
                              color: colors.text,
                              ...rtlText,
                            }}
                          >
                            {SHARED_LABEL[sharedLocation.source]}
                            <Text
                              style={{ ...type.footnote, color: colors.textTertiary }}
                            >
                              {" · "}
                              {relativeTimeLabel(sharedLocation.at)}
                            </Text>
                          </Text>
                          <Text
                            numberOfLines={2}
                            style={{
                              ...type.footnote,
                              color: colors.textSecondary,
                              ...rtlText,
                            }}
                          >
                            {sharedLocation.label || sharedLocation.url}
                          </Text>
                        </View>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`استخدام ${SHARED_LABEL[sharedLocation.source]}`}
                          onPress={() => {
                            tapFeedback();
                            setLocation(sharedLocation.value);
                            setValidation(null);
                          }}
                          style={({ pressed }) => ({
                            minHeight: hitSize.min - 8,
                            justifyContent: "center",
                            paddingHorizontal: spacing.md,
                            borderRadius: radius.full,
                            backgroundColor: pressed ? colors.brand : colors.brandSoft,
                          })}
                        >
                          {({ pressed }) => (
                            <Text
                              style={{
                                ...type.subheadStrong,
                                color: pressed ? colors.onBrand : colors.onBrandSoft,
                              }}
                            >
                              استخدام
                            </Text>
                          )}
                        </Pressable>
                      </View>
                      {sharedLocation.url ? <MapLink url={sharedLocation.url} /> : null}
                    </View>
                  )
                ) : null}
              </View>

              {/* Duration */}
              <View style={{ gap: spacing.sm }}>
                <Text style={{ ...type.subheadStrong, color: colors.text, ...rtlText }}>
                  مدة الجلسة
                </Text>

                <View
                  style={{
                    flexDirection: "row-reverse",
                    alignItems: "center",
                    gap: spacing.sm,
                  }}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="إنقاص المدة نصف ساعة"
                    onPress={() => adjustDuration(-durationStepHours)}
                    style={({ pressed }) => ({
                      width: hitSize.control,
                      height: hitSize.control,
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: radius.md,
                      backgroundColor: colors.surfaceSunken,
                      opacity: pressed ? 0.6 : 1,
                    })}
                  >
                    <Text style={{ ...type.title3, color: colors.text }}>−</Text>
                  </Pressable>

                  {/* Typed, not picked: sessions run to whatever length the
                      service needs, and a chip row can only ever offer a few. */}
                  <View
                    style={{
                      flex: 1,
                      flexDirection: "row-reverse",
                      alignItems: "center",
                      gap: spacing.sm,
                      minHeight: hitSize.control,
                      paddingHorizontal: spacing.md + 2,
                      borderRadius: radius.md,
                      borderCurve: "continuous",
                      borderWidth: durationError ? 1.5 : 1,
                      borderColor: durationError ? colors.danger : colors.border,
                      backgroundColor: colors.surface,
                    }}
                  >
                    <TextInput
                      accessibilityLabel="مدة الجلسة بالساعات"
                      keyboardType="decimal-pad"
                      inputMode="decimal"
                      maxLength={4}
                      selectTextOnFocus
                      value={durationText}
                      onChangeText={(next) =>
                        setDurationText(
                          normalizeNumeric(next).replace(/[^0-9.]/g, ""),
                        )
                      }
                      style={{
                        flex: 1,
                        ...type.bodyStrong,
                        color: colors.text,
                        fontVariant: ["tabular-nums"],
                        textAlign: "right",
                      }}
                    />
                    <Text style={{ ...type.callout, color: colors.textTertiary }}>
                      ساعة
                    </Text>
                  </View>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="زيادة المدة نصف ساعة"
                    onPress={() => adjustDuration(durationStepHours)}
                    style={({ pressed }) => ({
                      width: hitSize.control,
                      height: hitSize.control,
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: radius.md,
                      backgroundColor: colors.surfaceSunken,
                      opacity: pressed ? 0.6 : 1,
                    })}
                  >
                    <Text style={{ ...type.title3, color: colors.text }}>+</Text>
                  </Pressable>
                </View>

                {durationError ? (
                  <Text
                    accessibilityRole="alert"
                    style={{ ...type.footnote, color: colors.danger, ...rtlText }}
                  >
                    {durationError}
                  </Text>
                ) : (
                  <Text style={{ ...type.footnote, color: colors.textTertiary, ...rtlText }}>
                    بين نصف ساعة و{maxDurationHours} ساعات
                    {durationMinutes ? ` · ${durationLabel(durationMinutes)}` : ""}
                  </Text>
                )}
              </View>

              {/* Trip type */}
              <View style={{ gap: spacing.sm }}>
                <Text style={{ ...type.subheadStrong, color: colors.text, ...rtlText }}>
                  نوع الرحلة
                </Text>
                <Segmented
                  accessibilityLabel="نوع الرحلة"
                  options={[
                    { value: "one_way", label: tripTypeLabel.one_way },
                    { value: "round_trip", label: tripTypeLabel.round_trip },
                  ]}
                  value={tripType}
                  onChange={(next) => setTripType(next as TripType)}
                />
                <Text style={{ ...type.footnote, color: colors.textTertiary, ...rtlText }}>
                  يُحفظ الموعد الآن، ثم تختارين الأخصائية والسائق في شاشة طلب
                  السائق.
                </Text>
              </View>

              {create.error ? <InlineAlert message={create.error.message} /> : null}
            </ScrollView>

            <ActionBar bottomInset={insets.bottom}>
              <PrimaryButton
                label="تأكيد الحجز"
                icon="checkmark.circle"
                loading={create.isPending}
                disabled={!durationValid}
                onPress={confirm}
              />
            </ActionBar>
          </>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}
