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

async function notificationIdentity(
  requestPermission: boolean,
  keys: { device: string; token: string },
) {
  const id = projectId();
  if (!Device.isDevice || !id) return null;
  await ensureAndroidChannel();
  const current = await Notifications.getPermissionsAsync();
  const permission =
    permissionGranted(current)
      ? current
      : requestPermission
        ? await Notifications.requestPermissionsAsync()
        : current;
  if (!permissionGranted(permission)) return null;
  const expoToken = (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;
  await SecureStore.setItemAsync(keys.token, expoToken);
  return { expoToken, deviceId: await deviceId(keys.device) };
}

export async function registerFieldNotifications(): Promise<void> {
  const identity = await notificationIdentity(true, {
    device: FIELD_DEVICE_ID_KEY,
    token: FIELD_REGISTERED_TOKEN_KEY,
  });
  if (!identity) return;
  await apiRequest<{ registered: true }>("/field/push-token", {
    method: "POST",
    body: JSON.stringify(identity),
  });
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

export async function registerInboxNotifications(): Promise<void> {
  const identity = await notificationIdentity(true, {
    device: INBOX_DEVICE_ID_KEY,
    token: INBOX_REGISTERED_TOKEN_KEY,
  });
  if (!identity) return;
  const platform = process.env.EXPO_OS === "ios" ? "ios" : "android";
  await apiRequest<{ registered: true }>("/push-token", {
    method: "POST",
    body: JSON.stringify({ ...identity, platform }),
  });
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
