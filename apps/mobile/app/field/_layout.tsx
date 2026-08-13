import { Redirect } from "expo-router";
import { Stack } from "expo-router/stack";

import { ErrorState, LoadingScreen } from "@/components/screen-state";
import { useBootstrap } from "@/lib/queries";
import { useAuth } from "@/providers/auth-provider";

export default function FieldLayout() {
  const { session, loading } = useAuth();
  const bootstrap = useBootstrap(Boolean(session));
  if (loading || (session && bootstrap.isLoading)) return <LoadingScreen label="جارٍ تجهيز حسابك…" />;
  if (!session) return <Redirect href="/login" />;
  if (bootstrap.isError) {
    return (
      <ErrorState
        title="تعذر تجهيز الحساب"
        message={bootstrap.error.message}
        onRetry={() => void bootstrap.refetch()}
      />
    );
  }
  const role = bootstrap.data?.session.role;
  if (role !== "specialist" && role !== "driver") return <Redirect href="/inbox" />;

  return (
    <Stack>
      <Stack.Screen name="orders/index" options={{ title: "طلباتي", headerLargeTitle: true }} />
      <Stack.Screen name="orders/[id]" options={{ title: "تفاصيل الطلب" }} />
      <Stack.Screen name="account" options={{ title: "الحساب" }} />
    </Stack>
  );
}
