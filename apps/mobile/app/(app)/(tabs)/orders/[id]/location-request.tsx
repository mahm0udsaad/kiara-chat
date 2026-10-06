import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ActionBar, PrimaryButton } from "@/components/primary-button";
import { ErrorState, InlineAlert, LoadingScreen } from "@/components/screen-state";
import { Card } from "@/components/ui/card";
import { Field, TextAreaField } from "@/components/ui/field";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { radius, rtlText, spacing, type } from "@/constants/theme";
import { errorFeedback, successFeedback } from "@/lib/haptics";
import { useOrder, useOrderTracking, useSendDriverLocationRequest } from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";

/**
 * Asking the driver to allow location.
 *
 * What is in the two boxes is exactly what lands on his phone. The one thing
 * the app adds — tapping the notification opens the "allow location" window —
 * is stated below the boxes before anything is sent.
 */

const TITLE_MAX = 80;
const BODY_MAX = 400;

export default function DriverLocationRequestScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = useMemo(
    () => (Array.isArray(params.id) ? (params.id[0] ?? "") : (params.id ?? "")),
    [params.id],
  );
  const order = useOrder(id);
  const tracking = useOrderTracking(id);
  const send = useSendDriverLocationRequest(id);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const seeded = useRef(false);

  const driverName = tracking.data?.tracking.driver?.name ?? order.data?.order.driver_name ?? null;
  const customerName = order.data?.order.customer_name ?? null;

  // Suggested once, then entirely the employee's.
  useEffect(() => {
    if (seeded.current || !order.data) return;
    seeded.current = true;
    setTitle("فعّل الموقع لرحلة اليوم");
    setBody(
      `${driverName ? `مرحبًا ${driverName}، ` : "مرحبًا، "}نرجو السماح لتطبيق كيارا بمعرفة موقعك أثناء رحلة ${
        customerName || "العميلة"
      } حتى نعرف وقت وصولك المتوقع دون الاتصال بك أثناء القيادة. اضغط على هذا الإشعار ثم «السماح بالموقع».`,
    );
  }, [order.data, driverName, customerName]);

  if (order.isLoading) return <LoadingScreen label="جارٍ التحميل…" />;
  if (order.isError || !order.data) {
    return (
      <ErrorState
        title="تعذر تحميل الطلب"
        message={order.error?.message ?? "الطلب غير موجود"}
        onRetry={() => void order.refetch()}
      />
    );
  }

  const canPush = tracking.data?.tracking.driver?.canReceivePush ?? true;

  const submit = () => {
    const finalTitle = title.trim();
    const finalBody = body.trim();
    if (!finalTitle || !finalBody) {
      setProblem("اكتبي عنوان الإشعار ونصه قبل الإرسال.");
      return;
    }
    setProblem(null);
    send.mutate(
      { title: finalTitle, body: finalBody },
      {
        onSuccess: ({ delivery }) => {
          if (!delivery.accepted) {
            errorFeedback();
            setProblem("لم يصل الإشعار لجوال السائق. تأكدي أن التطبيق مثبت ومسجّل على جواله، أو اتصلي به.");
            return;
          }
          successFeedback();
          router.back();
        },
        onError: (error) => {
          errorFeedback();
          setProblem(error.message || "تعذر إرسال الطلب.");
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
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing["3xl"] }}
      >
        <Card>
          <Text style={{ ...type.headline, color: colors.text, ...rtlText }}>
            {driverName ? `إلى: ${driverName}` : "إلى: سائق الطلب"}
          </Text>
          <Text style={{ ...type.footnote, color: colors.textSecondary, ...rtlText }}>
            يصل كإشعار على تطبيق السائق.
          </Text>
        </Card>

        <Field
          label="عنوان الإشعار"
          value={title}
          onChangeText={setTitle}
          maxLength={TITLE_MAX}
        />
        <TextAreaField
          label="نص الإشعار"
          value={body}
          onChangeText={setBody}
          maxLength={BODY_MAX}
        />

        <View
          style={{
            flexDirection: "row-reverse",
            alignItems: "flex-start",
            gap: spacing.sm,
            padding: spacing.md,
            borderRadius: radius.md,
            backgroundColor: colors.infoSoft,
          }}
        >
          <IconSymbol name="info.circle" color={colors.onInfoSoft} size={16} />
          <Text style={{ flex: 1, ...type.footnote, color: colors.onInfoSoft, ...rtlText }}>
            يُضاف تلقائيًا: عند ضغط السائق على الإشعار تفتح له نافذة «السماح بالموقع» في التطبيق. إذا كان قد رفض سابقًا تظهر له طريقة التفعيل من الإعدادات. لا يُفرض عليه شيء، والتطبيق يعمل كالمعتاد إذا لم يوافق.
          </Text>
        </View>

        {!canPush ? (
          <InlineAlert tone="warning" message="لا يوجد جهاز مسجّل للسائق لاستقبال الإشعارات." />
        ) : null}
        {problem ? <InlineAlert message={problem} /> : null}
      </ScrollView>
      <ActionBar bottomInset={insets.bottom}>
        <PrimaryButton
          label="إرسال للسائق"
          icon="paperplane.fill"
          loading={send.isPending}
          loadingLabel="جارٍ الإرسال…"
          disabled={!canPush || !title.trim() || !body.trim()}
          onPress={submit}
        />
      </ActionBar>
    </KeyboardAvoidingView>
  );
}
