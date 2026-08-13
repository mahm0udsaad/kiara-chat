import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";

import { apiRequest } from "@/lib/api";

const FIELD_DEVICE_ID_KEY = "kiara-field-device-id";
const FIELD_REGISTERED_TOKEN_KEY = "kiara-field-expo-token";
const INBOX_DEVICE_ID_KEY = "kiara-inbox-device-id";
const INBOX_REGISTERED_TOKEN_KEY = "kiara-inbox-expo-token";

async function deviceId(key: string): Promise<string> {
  const stored = await SecureStore.getItemAsync(key);
  if (stored) return stored;
  const created = Crypto.randomUUID();
  await SecureStore.setItemAsync(key, created);
  return created;
}

async function ensureAndroidChannel(): Promise<void> {
  if (process.env.EXPO_OS !== "android") return;
  await Notifications.setNotificationChannelAsync("default", {
    name: "تنبيهات كيارا",
    description: "الرسائل الجديدة والطلبات والخطوات المطلوبة",
    importance: Notifications.AndroidImportance.HIGH,
    enableVibrate: true,
    vibrationPattern: [0, 250, 180, 250],
    lightColor: "#2B3FB0",
  });
}

function permissionGranted(permission: Notifications.NotificationPermissionsStatus): boolean {
  if (process.env.EXPO_OS !== "ios") return permission.status === "granted";
  const iosStatus = permission.ios?.status;
  return (
    iosStatus === Notifications.IosAuthorizationStatus.AUTHORIZED ||
    iosStatus === Notifications.IosAuthorizationStatus.PROVISIONAL ||
    iosStatus === Notifications.IosAuthorizationStatus.EPHEMERAL
  );
}

function projectId(): string | undefined {
  return (
    Constants.easConfig?.projectId ??
    (Constants.expoConfig?.extra?.eas?.projectId as string | undefined) ??
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID
  );
}

/**
 * Why a device is not receiving push, in the words the account screen shows.
 *
 * Registration used to return void and every caller swallowed the failure, so
 * a phone that never registered looked exactly like one that did — and the
 * team simply got no alerts, with nothing anywhere saying why.
 */
export type NotificationRegistration =
  | { state: "registered" }
  | { state: "simulator" }
  | { state: "no_project_id" }
  | { state: "denied" }
  | { state: "failed"; message: string };

export const notificationStateLabel: Record<
  NotificationRegistration["state"],
  string
> = {
  registered: "الإشعارات مفعّلة على هذا الجهاز.",
  simulator: "الإشعارات لا تعمل على المحاكي — جرّبي على جهاز حقيقي.",
  no_project_id: "إعداد المشروع ناقص (EAS project id).",
  denied: "الإشعارات محظورة. فعّليها من إعدادات الجهاز ثم أعيدي المحاولة.",
  failed: "تعذّر تفعيل الإشعارات.",
};

type Identity = { expoToken: string; deviceId: string };

async function notificationIdentity(
  requestPermission: boolean,
  keys: { device: string; token: string },
): Promise<Identity | NotificationRegistration> {
  const id = projectId();
  // Expo push tokens are only issued to real hardware; a simulator always
  // fails here, which is the single most common reason for "no alerts".
  if (!Device.isDevice) return { state: "simulator" };
  if (!id) return { state: "no_project_id" };
  await ensureAndroidChannel();
  const current = await Notifications.getPermissionsAsync();
  const permission =
    permissionGranted(current)
      ? current
      : requestPermission
        ? await Notifications.requestPermissionsAsync()
        : current;
  if (!permissionGranted(permission)) return { state: "denied" };
  const expoToken = (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;
  await SecureStore.setItemAsync(keys.token, expoToken);
  return { expoToken, deviceId: await deviceId(keys.device) };
}

function isIdentity(
  value: Identity | NotificationRegistration,
): value is Identity {
  return "expoToken" in value;
}

export async function registerFieldNotifications(): Promise<NotificationRegistration> {
  const identity = await notificationIdentity(true, {
    device: FIELD_DEVICE_ID_KEY,
    token: FIELD_REGISTERED_TOKEN_KEY,
  });
  if (!isIdentity(identity)) return identity;
  try {
    await apiRequest<{ registered: true }>("/field/push-token", {
      method: "POST",
      body: JSON.stringify(identity),
    });
    return { state: "registered" };
  } catch (error) {
    return {
      state: "failed",
      message: error instanceof Error ? error.message : "تعذّر تفعيل الإشعارات",
    };
  }
}

export async function unregisterFieldNotifications(): Promise<void> {
  const registeredToken = await SecureStore.getItemAsync(FIELD_REGISTERED_TOKEN_KEY);
  const storedDeviceId = await SecureStore.getItemAsync(FIELD_DEVICE_ID_KEY);
  if (!registeredToken || !storedDeviceId) return;
  await apiRequest<{ registered: false }>("/field/push-token", {
    method: "DELETE",
    body: JSON.stringify({ deviceId: storedDeviceId }),
  });
  await SecureStore.deleteItemAsync(FIELD_REGISTERED_TOKEN_KEY);
}

export async function registerInboxNotifications(): Promise<NotificationRegistration> {
  const identity = await notificationIdentity(true, {
    device: INBOX_DEVICE_ID_KEY,
    token: INBOX_REGISTERED_TOKEN_KEY,
  });
  if (!isIdentity(identity)) return identity;
  const platform = process.env.EXPO_OS === "ios" ? "ios" : "android";
  try {
    await apiRequest<{ registered: true }>("/push-token", {
      method: "POST",
      body: JSON.stringify({ ...identity, platform }),
    });
    return { state: "registered" };
  } catch (error) {
    return {
      state: "failed",
      message: error instanceof Error ? error.message : "تعذّر تفعيل الإشعارات",
    };
  }
}

export async function unregisterInboxNotifications(): Promise<void> {
  const registeredToken = await SecureStore.getItemAsync(INBOX_REGISTERED_TOKEN_KEY);
  const storedDeviceId = await SecureStore.getItemAsync(INBOX_DEVICE_ID_KEY);
  if (!registeredToken || !storedDeviceId) return;
  await apiRequest<{ registered: false }>("/push-token", {
    method: "DELETE",
    body: JSON.stringify({ deviceId: storedDeviceId }),
  });
  await SecureStore.deleteItemAsync(INBOX_REGISTERED_TOKEN_KEY);
}
