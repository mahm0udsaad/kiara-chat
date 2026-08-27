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

/**
 * What was last accepted by the server, so an unchanged token is not re-sent.
 *
 * Registration is triggered from several places — mount, the account screen's
 * retry, and the OS rotating the native token — and none of them knew whether
 * the value had actually changed. Combined with the fact that acquiring a token
 * can itself emit a token event, that turned one rotation into a burst of
 * identical uploads.
 */
const SENT_SUFFIX = ".sent";

/**
 * Collapses concurrent registrations of the same kind into one call.
 *
 * The listener path and the mount path can fire in the same tick, and each was
 * an independent round trip uploading the same token.
 */
const inFlight = new Map<string, Promise<NotificationRegistration>>();

function once(
  key: string,
  run: () => Promise<NotificationRegistration>,
): Promise<NotificationRegistration> {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const started = run().finally(() => inFlight.delete(key));
  inFlight.set(key, started);
  return started;
}

/**
 * Shared body of both registrations: resolve the device's identity, skip the
 * upload when the server already has exactly this token, otherwise send it and
 * remember what was accepted.
 */
async function registerPush(
  keys: { device: string; token: string },
  path: string,
  extra: Record<string, string> = {},
): Promise<NotificationRegistration> {
  return once(path, async () => {
    const identity = await notificationIdentity(true, keys);
    if (!isIdentity(identity)) return identity;

    const fingerprint = `${identity.expoToken}|${identity.deviceId}`;
    const sentKey = `${keys.token}${SENT_SUFFIX}`;
    // Only a previously *accepted* upload short-circuits, so the account
    // screen's retry after a failure still reaches the server.
    if ((await SecureStore.getItemAsync(sentKey)) === fingerprint) {
      return { state: "registered" };
    }

    try {
      await apiRequest<{ registered: true }>(path, {
        method: "POST",
        body: JSON.stringify({ ...identity, ...extra }),
      });
      await SecureStore.setItemAsync(sentKey, fingerprint);
      return { state: "registered" };
    } catch (error) {
      // A rejected upload must not be remembered as sent, or a genuinely
      // unregistered device would never try again.
      await SecureStore.deleteItemAsync(sentKey).catch(() => {});
      return {
        state: "failed",
        message: error instanceof Error ? error.message : "تعذّر تفعيل الإشعارات",
      };
    }
  });
}

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
  return registerPush(
    { device: FIELD_DEVICE_ID_KEY, token: FIELD_REGISTERED_TOKEN_KEY },
    "/field/push-token",
  );
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
  await SecureStore.deleteItemAsync(`${FIELD_REGISTERED_TOKEN_KEY}${SENT_SUFFIX}`);
}

export async function fieldNotificationDeviceId(): Promise<string | null> {
  return SecureStore.getItemAsync(FIELD_DEVICE_ID_KEY);
}

export async function registerInboxNotifications(): Promise<NotificationRegistration> {
  return registerPush(
    { device: INBOX_DEVICE_ID_KEY, token: INBOX_REGISTERED_TOKEN_KEY },
    "/push-token",
    { platform: process.env.EXPO_OS === "ios" ? "ios" : "android" },
  );
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
  await SecureStore.deleteItemAsync(`${INBOX_REGISTERED_TOKEN_KEY}${SENT_SUFFIX}`);
}
