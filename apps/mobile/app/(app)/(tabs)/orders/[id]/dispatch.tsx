import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ActionBar, PrimaryButton } from "@/components/primary-button";
import { RosterPicker } from "@/components/roster-picker";
import { ErrorState, InlineAlert, LoadingScreen } from "@/components/screen-state";
import { Card } from "@/components/ui/card";
import { TextAreaField } from "@/components/ui/field";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { hitSize, radius, rtlText, spacing, type } from "@/constants/theme";
import {
  durationLabel,
  formatters,
  relativeDayLabel,
  tripTypeLabel,
} from "@/lib/format";
import { successFeedback, tapFeedback, warningFeedback } from "@/lib/haptics";
import {
  useDispatchOptions,
  useDispatchOrder,
  useDispatchPreview,
  useOrder,
} from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";

const noteMaxLength = 500;

/** Starters that cover the notes operators write most often. */
const noteTemplates = [
  "يرجى الوصول قبل الموعد بعشر دقائق.",
  "الجلسة تنظيف بشرة كامل.",
  "العميلة تفضّل الهدوء أثناء الجلسة.",
  "يرجى إحضار الأدوات الإضافية.",
];

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

function DispatchForm({ id }: { id: string }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const order = useOrder(id);
  const options = useDispatchOptions();
  const dispatch = useDispatchOrder(id);
  const preparePreview = useDispatchPreview(id);

  const [specialistId, setSpecialistId] = useState<string | null>(null);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [validation, setValidation] = useState<string | null>(null);
  const [driverMessage, setDriverMessage] = useState("");
  const [specialistMessage, setSpecialistMessage] = useState("");
  const [specialistLanguage, setSpecialistLanguage] = useState("العربية");
  const [automaticAdditions, setAutomaticAdditions] = useState<string[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const initializedAssignments = useRef(false);

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
  const specialistName =
    options.data.specialists.find((person) => person.id === specialistId)?.full_name ?? null;
  const driverName =
    options.data.drivers.find((person) => person.id === driverId)?.full_name ?? null;

  const review = () => {
    if (!specialistId) return setValidation("اختاري الأخصائية.");
    if (!driverId) return setValidation("اختاري السائق.");
    if (!note.trim()) return setValidation("اكتبي رسالة للأخصائية.");
    setValidation(null);
    warningFeedback();
    preparePreview.mutate(
      {
        specialistId,
        driverId,
        specialistNote: note.trim(),
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
      },
    );
  };

  const send = () => {
    if (!specialistId || !driverId) return;
    if (!driverMessage.trim() || !specialistMessage.trim()) {
      return setValidation("راجعي نص الرسالتين قبل الإرسال.");
    }
    dispatch.mutate(
      {
        specialistId,
        driverId,
        driverMessage: driverMessage.trim(),
        specialistMessage: specialistMessage.trim(),
        expectedVersion: current.version,
      },
      {
        onSuccess: () => {
          successFeedback();
          router.back();
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
          <SummaryLine icon="mappin.and.ellipse" text={current.customer_location} />
        </Card>

        {!reviewing ? (
          <>
            <InlineAlert
              tone="info"
              message="سننشئ الرسالة النهائية ونترجمها حسب جنسية الأخصائية، ثم ستراجعين النصين وتعدّلينهما قبل الإرسال."
            />

            <RosterPicker
              label="الأخصائية"
              options={options.data.specialists}
              value={specialistId}
              onChange={setSpecialistId}
              error={validation && !specialistId ? validation : null}
            />
            <RosterPicker
              label="السائق"
              options={options.data.drivers}
              value={driverId}
              onChange={setDriverId}
              error={validation && specialistId && !driverId ? validation : null}
            />

            <View style={{ gap: spacing.sm }}>
              <TextAreaField
                label="تعليمات الأخصائية بالعربية"
                value={note}
                onChangeText={setNote}
                maxLength={noteMaxLength}
                placeholder="مثال: الجلسة تنظيف بشرة، يرجى الوصول قبل الموعد بعشر دقائق…"
                error={validation && specialistId && driverId && !note.trim() ? validation : null}
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
          </>
        ) : (
          <View style={{ gap: spacing.lg }}>
            <InlineAlert
              tone="warning"
              message={`هذه هي الرسائل النهائية إلى ${specialistName} و${driverName}. عدّلي أي نص الآن؛ سيُرسل الظاهر هنا حرفيًا.`}
            />
            <TextAreaField
              label="رسالة السائق النهائية"
              value={driverMessage}
              onChangeText={setDriverMessage}
              maxLength={3_000}
              minHeight={180}
            />
            <TextAreaField
              label={`رسالة الأخصائية النهائية · ${specialistLanguage}`}
              value={specialistMessage}
              onChangeText={setSpecialistMessage}
              maxLength={3_000}
              minHeight={220}
            />
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
          </View>
        )}

        {preparePreview.error ? <InlineAlert message={preparePreview.error.message} /> : null}
        {dispatch.error ? <InlineAlert message={dispatch.error.message} /> : null}
      </ScrollView>

      <ActionBar bottomInset={insets.bottom}>
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
              onPress={() => setReviewing(false)}
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
