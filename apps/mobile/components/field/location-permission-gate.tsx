import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useState } from "react";
import { AppState, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PrimaryButton } from "@/components/primary-button";
import { IconSymbol, type IconName } from "@/components/ui/icon-symbol";
import { hitSize, radius, rtlText, spacing, type } from "@/constants/theme";
import {
  askLocationPermission,
  askToEnableLocationServices,
  onLocationPromptRequested,
  openAppSettings,
  readLocationPermission,
  reportLocationStatus,
  type LocationSnapshot,
} from "@/lib/driver-location";
import { useTheme } from "@/providers/theme-provider";

/**
 * The driver's "allow location" window.
 *
 * Shown at most once a day while location is not allowed, and at once when the
 * office sends a request. It only explains and offers: "not now" closes it and
 * the app carries on exactly as before, and nothing else on the driver's
 * screens ever raises the system dialog. Every open, answer and return from
 * Settings is reported, so customer service sees the real state.
 */

const LAST_SHOWN_KEY = "kiara.locationPrompt.lastShownDay";

const today = () => new Date().toISOString().slice(0, 10);

async function shownToday(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(LAST_SHOWN_KEY)) === today();
  } catch {
    // Unknown storage: err on the side of not nagging.
    return true;
  }
}

function rememberShown(): void {
  void SecureStore.setItemAsync(LAST_SHOWN_KEY, today()).catch(() => undefined);
}

function Point({ icon, text }: { icon: IconName; text: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.md }}>
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: radius.full,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.brandSoft,
        }}
      >
        <IconSymbol name={icon} color={colors.onBrandSoft} size={17} />
      </View>
      <Text style={{ flex: 1, ...type.subhead, color: colors.text, ...rtlText }}>{text}</Text>
    </View>
  );
}

export function LocationPermissionGate() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<LocationSnapshot | null>(null);
  const [busy, setBusy] = useState(false);

  /** Re-reads the state, reports it, and decides whether to show the window. */
  const check = useCallback(async (reason: "launch" | "foreground" | "request") => {
    const current = await readLocationPermission();
    setSnapshot(current);
    reportLocationStatus(current);
    const needsAction =
      current.permission !== "granted" || current.servicesEnabled === false;
    if (!needsAction) {
      // Allowed in Settings while the window was up: nothing left to ask.
      setOpen(false);
      return;
    }
    if (current.permission === "unavailable") return;
    if (reason === "request" || !(await shownToday())) {
      rememberShown();
      setOpen(true);
    }
  }, []);

  useEffect(() => {
    // A moment after launch, so the window never lands on a screen still
    // loading its first order.
    const launch = setTimeout(() => void check("launch"), 1_500);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void check("foreground");
    });
    const unsubscribe = onLocationPromptRequested(() => void check("request"));
    return () => {
      clearTimeout(launch);
      subscription.remove();
      unsubscribe();
    };
  }, [check]);

  const close = () => setOpen(false);

  const allow = async () => {
    if (busy) return;
    setBusy(true);
    try {
      let next = snapshot;
      if (snapshot?.permission === "blocked") {
        // Only Settings can change it now; the foreground check picks it up.
        openAppSettings();
        return;
      }
      if (snapshot?.permission !== "granted") next = await askLocationPermission();
      if (next?.permission === "granted" && next.servicesEnabled === false) {
        await askToEnableLocationServices();
        next = await readLocationPermission();
      }
      if (next) {
        setSnapshot(next);
        reportLocationStatus(next);
        if (next.permission === "granted" && next.servicesEnabled !== false) setOpen(false);
      }
    } finally {
      setBusy(false);
    }
  };

  const blocked = snapshot?.permission === "blocked";
  const servicesOff = snapshot?.permission === "granted" && snapshot.servicesEnabled === false;
  const refusedNow = snapshot?.permission === "denied";

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(10, 14, 30, 0.45)" }}>
        <View
          style={{
            maxHeight: "88%",
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            borderCurve: "continuous",
            backgroundColor: colors.surface,
            paddingBottom: insets.bottom + spacing.lg,
          }}
        >
          <View style={{ flexDirection: "row-reverse", justifyContent: "flex-start", padding: spacing.md }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="إغلاق"
              onPress={close}
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
          <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.xl, gap: spacing.lg }}>
            <View style={{ alignItems: "center", gap: spacing.md }}>
              <View
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: radius.full,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: colors.brandSoft,
                }}
              >
                <IconSymbol name="mappin.and.ellipse" color={colors.brand} size={34} />
              </View>
              <Text style={{ ...type.title2, color: colors.text, textAlign: "center" }}>
                {servicesOff ? "شغّل خدمة الموقع في جوالك" : "اسمح بمعرفة موقعك أثناء الرحلة"}
              </Text>
              <Text style={{ ...type.body, color: colors.textSecondary, textAlign: "center" }}>
                {servicesOff
                  ? "الإذن مفعّل لكن خدمة الموقع (GPS) مغلقة في الجوال، فلا يمكن حساب وقت الوصول."
                  : "يُستخدم موقعك فقط من تأكيد الرحلة حتى الوصول للعميلة، لحساب وقت الوصول المتوقع وتوثيق الرحلة."}
              </Text>
            </View>

            {!servicesOff ? (
              <View style={{ gap: spacing.md }}>
                <Point icon="clock" text="خدمة العملاء تعرف وقت وصولك بدقة بدل الاتصال بك أثناء القيادة." />
                <Point icon="checkmark.circle" text="يثبت وصولك في الموعد إذا حصل أي خلاف." />
                <Point icon="lock" text="لا يُسجّل موقعك خارج الرحلات أو بعد الوصول للعميلة." />
              </View>
            ) : null}

            {blocked ? (
              <View style={{ padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.infoSoft }}>
                <Text style={{ ...type.footnote, color: colors.onInfoSoft, ...rtlText }}>
                  رُفض الإذن سابقًا، لذلك يجب تفعيله من الإعدادات: افتح «الأذونات» ثم «الموقع» واختر «السماح أثناء استخدام التطبيق».
                </Text>
              </View>
            ) : refusedNow ? (
              <Text style={{ ...type.footnote, color: colors.textSecondary, ...rtlText }}>
                عند ظهور نافذة الجوال اختر «أثناء استخدام التطبيق».
              </Text>
            ) : null}

            <View style={{ gap: spacing.sm, paddingTop: spacing.sm }}>
              <PrimaryButton
                label={
                  blocked ? "فتح الإعدادات" : servicesOff ? "تشغيل الموقع" : "السماح بالموقع"
                }
                icon={blocked ? "gearshape" : "mappin.and.ellipse"}
                loading={busy}
                onPress={() => void allow()}
              />
              <PrimaryButton label="ليس الآن" variant="plain" silent onPress={close} />
            </View>
            <Text style={{ ...type.caption, color: colors.textTertiary, textAlign: "center" }}>
              إذا لم توافق يعمل التطبيق وكل الخطوات كالمعتاد.
            </Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
