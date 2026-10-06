import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, Image, KeyboardAvoidingView, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ActionBar, PrimaryButton } from "@/components/primary-button";
import { RosterPicker } from "@/components/roster-picker";
import { ErrorState, InlineAlert, LoadingScreen } from "@/components/screen-state";
import { TextAreaField } from "@/components/ui/field";
import { IconSymbol, type IconName } from "@/components/ui/icon-symbol";
import { Segmented } from "@/components/ui/segmented";
import { hitSize, radius, rtlText, spacing, type } from "@/constants/theme";
import { durationLabel, formatters, relativeDayLabel, tripTypeLabel } from "@/lib/format";
import { tapFeedback, successFeedback } from "@/lib/haptics";
import {
  useAddOrderDoorPhoto,
  useCancelOrder,
  useDispatchOptions,
  useOrder,
  useUpdateOrder,
} from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";
import type {
  DispatchOptionsResponse,
  OrderDetailResponse,
  TripType,
} from "@/types/api";

const durationPresets = [30, 45, 60, 90, 120];
const minDurationMinutes = 5;
const maxDurationMinutes = 480;
const maxDoorPhotoBytes = 4 * 1024 * 1024;

/** Row that reveals a native picker in place when tapped. */
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

function EditForm({
  data,
  options,
}: {
  data: OrderDetailResponse;
  options: DispatchOptionsResponse;
}) {
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const order = data.order;
  const update = useUpdateOrder(order.id);
  const addDoorPhoto = useAddOrderDoorPhoto(order.id);
  const cancelOrder = useCancelOrder(order.id);

  const confirmCancel = () => {
    Alert.alert(
      "إلغاء الطلب",
      "هل أنتِ متأكدة من إلغاء هذا الطلب؟ سيتم إرسال إشعار بذلك إلى السائق والأخصائية.",
      [
        { text: "تراجع", style: "cancel" },
        {
          text: "تأكيد الإلغاء",
          style: "destructive",
          onPress: () => {
            cancelOrder.mutate(undefined, {
              onSuccess: () => {
                successFeedback();
                router.back();
              },
            });
          },
        },
      ],
    );
  };

  const [arrival, setArrival] = useState(() => new Date(order.arrival_at));
  const [location, setLocation] = useState(order.customer_location);
  const [duration, setDuration] = useState(order.duration_minutes);
  const [tripType, setTripType] = useState<TripType>(order.trip_type);
  const [specialistId, setSpecialistId] = useState<string | null>(order.specialist_id);
  const [driverId, setDriverId] = useState<string | null>(order.driver_id);
  const [returnDriverId, setReturnDriverId] = useState<string | null>(
    order.return_driver_id ?? null,
  );
  const [doorPhoto, setDoorPhoto] = useState<{
    uri: string;
    name: string;
    type: string;
  } | null>(null);
  const [doorPhotoError, setDoorPhotoError] = useState<string | null>(null);
  const [picker, setPicker] = useState<"date" | "time" | null>(null);
  const [errors, setErrors] = useState<{ location?: string; duration?: string }>({});

  const onPickerChange = (event: DateTimePickerEvent, selected?: Date) => {
    // Android's picker is a dialog and reports its own dismissal.
    if (process.env.EXPO_OS !== "ios") setPicker(null);
    if (event.type === "dismissed" || !selected) return;
    setArrival(selected);
  };

  const adjustDuration = (delta: number) => {
    tapFeedback();
    setDuration((current) =>
      Math.min(maxDurationMinutes, Math.max(minDurationMinutes, current + delta)),
    );
  };

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
    if ((asset.fileSize ?? 0) > maxDoorPhotoBytes) {
      setDoorPhotoError("الصورة أكبر من اللازم. اختاري صورة أصغر من 4 ميجابايت.");
      return;
    }
    setDoorPhoto({
      uri: asset.uri,
      name: asset.fileName || `door-${Date.now()}.jpg`,
      type: asset.mimeType || "image/jpeg",
    });
  };

  const save = () => {
    const nextErrors: typeof errors = {};
    if (!location.trim()) nextErrors.location = "موقع العميلة مطلوب.";
    if (duration < minDurationMinutes || duration > maxDurationMinutes) {
      nextErrors.duration = `مدة الجلسة يجب أن تكون بين ${minDurationMinutes} و${maxDurationMinutes} دقيقة.`;
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    update.mutate(
      {
        arrivalAt: arrival.toISOString(),
        customerLocation: location.trim(),
        durationMinutes: duration,
        tripType,
        specialistId,
        driverId,
        returnDriverId: tripType === "one_way" ? returnDriverId : null,
        expectedVersion: order.version,
      },
      {
        onSuccess: ({ order: updatedOrder }) => {
          if (!doorPhoto) {
            successFeedback();
            router.back();
            return;
          }
          addDoorPhoto.mutate(
            { doorPhoto, expectedVersion: updatedOrder.version },
            {
              onSuccess: () => {
                successFeedback();
                router.back();
              },
              onError: (error) => setDoorPhotoError(error.message),
            },
          );
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
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{
          padding: spacing.lg,
          gap: spacing.xl,
          paddingBottom: spacing["3xl"],
        }}
      >
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
            onPress={() => setPicker((current) => (current === "date" ? null : "date"))}
          />
          <PickerRow
            icon="clock"
            label="الوقت"
            value={formatters.time.format(arrival)}
            active={picker === "time"}
            onPress={() => setPicker((current) => (current === "time" ? null : "time"))}
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
                onChange={onPickerChange}
              />
            </View>
          ) : null}
          <Text style={{ ...type.footnote, color: colors.textTertiary, ...rtlText }}>
            {formatters.fullDateTime.format(arrival)}
          </Text>
        </View>

        {/* Location */}
        <TextAreaField
          label="موقع العميلة"
          value={location}
          onChangeText={setLocation}
          minHeight={84}
          placeholder="العنوان أو رابط الموقع على الخرائط"
          error={errors.location}
        />

        {/* A missing door photo can be supplied later without resending the
            whole order. Existing photos stay immutable here to avoid replacing
            the driver's only visual landmark accidentally. */}
        <View style={{ gap: spacing.sm }}>
          <Text style={{ ...type.subheadStrong, color: colors.text, ...rtlText }}>
            صورة باب العميلة
          </Text>
          {order.door_photo_path ? (
            <View
              style={{
                minHeight: hitSize.control,
                flexDirection: "row-reverse",
                alignItems: "center",
                gap: spacing.sm,
                paddingHorizontal: spacing.md,
                borderRadius: radius.md,
                backgroundColor: colors.successSoft,
              }}
            >
              <IconSymbol name="checkmark.circle" size={20} color={colors.success} />
              <Text style={{ flex: 1, ...type.footnote, color: colors.text, ...rtlText }}>
                صورة الباب مضافة بالفعل
              </Text>
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={doorPhoto ? "تغيير صورة الباب" : "إضافة صورة باب العميلة"}
              onPress={pickDoorPhoto}
              style={({ pressed }) => ({
                minHeight: hitSize.control,
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
                {doorPhoto ? "الصورة جاهزة — اضغطي للتغيير" : "إضافة صورة الباب"}
              </Text>
              {doorPhoto ? (
                <Image
                  source={{ uri: doorPhoto.uri }}
                  accessibilityLabel="معاينة صورة باب العميلة"
                  style={{ width: 44, height: 44, borderRadius: radius.sm }}
                />
              ) : null}
            </Pressable>
          )}
          {doorPhotoError ? <InlineAlert message={doorPhotoError} /> : null}
        </View>

        {/* Duration */}
        <View style={{ gap: spacing.sm }}>
          <View style={{ flexDirection: "row-reverse", justifyContent: "space-between" }}>
            <Text style={{ ...type.subheadStrong, color: colors.text, ...rtlText }}>
              مدة الجلسة
            </Text>
            <Text
              style={{
                ...type.subheadStrong,
                color: colors.brand,
                fontVariant: ["tabular-nums"],
              }}
            >
              {durationLabel(duration)}
            </Text>
          </View>

          <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="إنقاص المدة ١٥ دقيقة"
              onPress={() => adjustDuration(-15)}
              style={({ pressed }) => ({
                width: hitSize.min,
                height: hitSize.min,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: radius.md,
                backgroundColor: colors.surfaceSunken,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text style={{ ...type.title3, color: colors.text }}>−</Text>
            </Pressable>

            <View style={{ flex: 1 }}>
              <Segmented
                layout="scroll"
                accessibilityLabel="مدة الجلسة السريعة"
                options={durationPresets.map((preset) => ({
                  value: String(preset),
                  label: durationLabel(preset),
                }))}
                value={String(duration)}
                onChange={(next) => setDuration(Number(next))}
              />
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="زيادة المدة ١٥ دقيقة"
              onPress={() => adjustDuration(15)}
              style={({ pressed }) => ({
                width: hitSize.min,
                height: hitSize.min,
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

          {errors.duration ? <InlineAlert message={errors.duration} /> : null}
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
            onChange={(next) => {
              const value = next as TripType;
              setTripType(value);
              if (value === "round_trip") setReturnDriverId(null);
            }}
          />
        </View>

        <RosterPicker
          label="الأخصائية"
          options={options.specialists}
          value={specialistId}
          onChange={setSpecialistId}
          allowEmpty
        />
        <RosterPicker
          label="سائق الذهاب"
          options={options.drivers}
          value={driverId}
          onChange={setDriverId}
          allowEmpty
        />
        {tripType === "one_way" ? (
          <View style={{ gap: spacing.xs }}>
            <RosterPicker
              label="سائق العودة (اختياري)"
              options={options.drivers.filter((driver) => driver.id !== driverId)}
              value={returnDriverId}
              onChange={setReturnDriverId}
              allowEmpty
            />
            <Text selectable style={{ ...type.caption, color: colors.textTertiary, ...rtlText }}>
              يظهر له الطلب فورًا، ولا يملك إلا زر إنهاء رحلة العودة بعد انتهاء الخدمة.
            </Text>
          </View>
        ) : null}

        {update.error ? <InlineAlert message={update.error.message} /> : null}
      </ScrollView>

      <ActionBar bottomInset={insets.bottom}>
        <PrimaryButton
          label="حفظ التعديل"
          icon="checkmark"
          loading={update.isPending || addDoorPhoto.isPending}
          disabled={cancelOrder.isPending}
          onPress={save}
        />
        {order.status !== "cancelled" ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="إلغاء الطلب"
            onPress={confirmCancel}
            disabled={update.isPending || addDoorPhoto.isPending || cancelOrder.isPending}
            style={({ pressed }) => ({
              minHeight: hitSize.control,
              flexDirection: "row-reverse",
              alignItems: "center",
              justifyContent: "center",
              paddingHorizontal: spacing.md,
              borderRadius: radius.lg,
              borderCurve: "continuous",
              backgroundColor: colors.dangerSoft,
              opacity:
                pressed || update.isPending || addDoorPhoto.isPending || cancelOrder.isPending
                  ? 0.6
                  : 1,
            })}
          >
            <Text style={{ ...type.bodyStrong, color: colors.onDangerSoft, ...rtlText }}>
              {cancelOrder.isPending ? "جارٍ الإلغاء…" : "إلغاء الطلب"}
            </Text>
          </Pressable>
        ) : null}
      </ActionBar>
    </KeyboardAvoidingView>
  );
}

export default function EditOrderScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = useMemo(
    () => (Array.isArray(params.id) ? (params.id[0] ?? "") : (params.id ?? "")),
    [params.id],
  );
  const order = useOrder(id);
  const options = useDispatchOptions();

  if (order.isLoading || options.isLoading) return <LoadingScreen label="جارٍ تجهيز الطلب…" />;
  if (order.isError || options.isError || !order.data || !options.data) {
    const message = order.error?.message || options.error?.message || "تعذر تحميل الطلب";
    return (
      <ErrorState
        message={message}
        onRetry={() => {
          void order.refetch();
          void options.refetch();
        }}
      />
    );
  }
  return <EditForm data={order.data} options={options.data} />;
}
