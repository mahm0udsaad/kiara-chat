import { Redirect } from "expo-router";
import { Stack } from "expo-router/stack";

import { ErrorState, LoadingScreen } from "@/components/screen-state";
import { useBootstrap } from "@/lib/queries";
import {
  fieldLocaleForSession,
  FieldI18nProvider,
  useFieldI18n,
} from "@/lib/field-i18n";
import { useAuth } from "@/providers/auth-provider";

function FieldNavigator() {
  const { t } = useFieldI18n();
  return (
    <Stack>
      <Stack.Screen name="orders/index" options={{ title: t("myOrders"), headerLargeTitle: true }} />
      <Stack.Screen name="orders/[id]" options={{ title: t("orderDetails") }} />
      <Stack.Screen name="account" options={{ title: t("account") }} />
    </Stack>
  );
}

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

  const locale = fieldLocaleForSession(
    role,
    bootstrap.data?.session.nationality,
    bootstrap.data?.session.preferredLanguage,
  );

  return (
    <FieldI18nProvider locale={locale}>
      <FieldNavigator />
    </FieldI18nProvider>
  );
}
