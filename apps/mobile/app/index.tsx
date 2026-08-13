import { Redirect } from "expo-router";

import { ErrorState, LoadingScreen } from "@/components/screen-state";
import { useAuth } from "@/providers/auth-provider";
import { useBootstrap } from "@/lib/queries";

export default function IndexScreen() {
  const { session, loading } = useAuth();
  const bootstrap = useBootstrap(Boolean(session));
  if (loading) return <LoadingScreen />;
  if (!session) return <Redirect href="/login" />;
  if (bootstrap.isLoading) return <LoadingScreen label="جارٍ تجهيز حسابك…" />;
  if (bootstrap.isError) {
    return (
      <ErrorState
        title="تعذر تجهيز الحساب"
        message={bootstrap.error.message}
        onRetry={() => void bootstrap.refetch()}
      />
    );
  }
  if (bootstrap.data?.session.role === "specialist" || bootstrap.data?.session.role === "driver") {
    return <Redirect href="/field/orders" />;
  }
  return <Redirect href="/inbox" />;
}
