import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef } from "react";
import { ScrollView } from "react-native";

import { CustomerAnalysisView } from "@/components/customer-analysis-view";
import { PrimaryButton } from "@/components/primary-button";
import { ErrorState, LoadingScreen } from "@/components/screen-state";
import { spacing } from "@/constants/theme";
import { useAnalyzeOrder } from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";

/**
 * The order-scoped read of the customer's experience. Analyses on mount
 * because opening this modal is itself the request; the same verdict is
 * available on demand from the customer profile, which shares the rendering.
 */
export default function OrderAnalysisScreen() {
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = useMemo(
    () => (Array.isArray(params.id) ? (params.id[0] ?? "") : (params.id ?? "")),
    [params.id],
  );
  const analysisRequest = useAnalyzeOrder(id);
  const started = useRef(false);

  useEffect(() => {
    if (!id || started.current) return;
    started.current = true;
    analysisRequest.mutate();
  }, [analysisRequest, id]);

  if (!id) return <ErrorState title="طلب غير صالح" message="لم يتم تحديد الطلب." />;
  if (analysisRequest.isPending || (!analysisRequest.data && !analysisRequest.isError)) {
    return <LoadingScreen label="جارٍ تحليل محادثة العميلة وحجوزاتها…" />;
  }
  if (analysisRequest.isError || !analysisRequest.data) {
    return (
      <ErrorState
        title="تعذر التحليل"
        message={analysisRequest.error?.message ?? "تعذر تحليل بيانات العميلة."}
        onRetry={() => analysisRequest.mutate()}
      />
    );
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        padding: spacing.lg,
        gap: spacing.lg,
        paddingBottom: spacing["4xl"],
      }}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <CustomerAnalysisView analysis={analysisRequest.data.analysis} />

      <PrimaryButton
        label="إعادة التحليل"
        icon="arrow.clockwise"
        variant="outline"
        loading={analysisRequest.isPending}
        onPress={() => analysisRequest.mutate()}
      />
    </ScrollView>
  );
}
