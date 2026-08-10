import { Redirect } from "expo-router";
import { Stack } from "expo-router/stack";

import { LoadingScreen } from "@/components/screen-state";
import { useAuth } from "@/providers/auth-provider";

export default function AppLayout() {
  const { session, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!session) return <Redirect href="/login" />;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
    </Stack>
  );
}
