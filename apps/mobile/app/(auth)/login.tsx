import { Redirect } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, ScrollView, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

import { PrimaryButton } from "@/components/primary-button";
import { InlineAlert } from "@/components/screen-state";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { radius, rtlText, spacing, type } from "@/constants/theme";
import { errorFeedback } from "@/lib/haptics";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";
import { useTheme } from "@/providers/theme-provider";

export default function LoginScreen() {
  const { colors } = useTheme();
  const { session } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (session) return <Redirect href="/inbox" />;

  const signIn = async () => {
    if (!isSupabaseConfigured) {
      setError("بيانات Supabase غير موجودة. انسخي .env.example إلى .env.");
      return;
    }
    if (!email.trim() || !password) {
      setError("أدخلي البريد الإلكتروني وكلمة المرور.");
      return;
    }
    setLoading(true);
    setError(null);
    const result = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (result.error) {
      errorFeedback();
      setError("تعذر تسجيل الدخول. تحققي من البريد الإلكتروني وكلمة المرور.");
    }
    setLoading(false);
  };

  return (
    <KeyboardAvoidingView
      behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          padding: spacing["2xl"],
          gap: spacing["3xl"],
        }}
      >
        <Animated.View
          entering={FadeInDown.duration(420)}
          style={{ alignItems: "flex-end", gap: spacing.md }}
        >
          <View
            style={{
              width: 60,
              height: 60,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: radius["2xl"],
              borderCurve: "continuous",
              backgroundColor: colors.brand,
            }}
          >
            <IconSymbol name="sparkles" color={colors.onBrand} size={30} />
          </View>
          <View style={{ gap: spacing.xs, alignItems: "flex-end" }}>
            <Text style={{ ...type.largeTitle, color: colors.text, ...rtlText }}>كيارا</Text>
            <Text style={{ ...type.body, color: colors.textSecondary, ...rtlText }}>
              تطبيق فريق العمليات
            </Text>
          </View>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(120).duration(420)}>
          <Card variant="raised" style={{ gap: spacing.lg, padding: spacing.xl }}>
            <Field
              label="البريد الإلكتروني"
              icon="envelope"
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              keyboardType="email-address"
              returnKeyType="next"
              placeholder="name@kiara.sa"
              value={email}
              onChangeText={setEmail}
            />
            <Field
              label="كلمة المرور"
              icon="lock"
              secure
              autoCapitalize="none"
              autoComplete="current-password"
              returnKeyType="go"
              placeholder="••••••••"
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={() => void signIn()}
            />
            {error ? <InlineAlert message={error} /> : null}
            <PrimaryButton
              label="تسجيل الدخول"
              icon="arrow.up.circle.fill"
              loading={loading}
              onPress={() => void signIn()}
            />
          </Card>
        </Animated.View>

        <Text
          style={{
            ...type.footnote,
            color: colors.textTertiary,
            textAlign: "center",
          }}
        >
          الدخول مخصص لفريق خدمة العملاء والإدارة
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
