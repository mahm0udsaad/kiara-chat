import "react-native-url-polyfill/auto";

import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { AppState } from "react-native";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? "";
const publishableKey =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";

export const isSupabaseConfigured = Boolean(supabaseUrl && publishableKey);

// expo-secure-store on Android is Keystore-backed and only reliably holds
// values up to ~2048 bytes; past that it warns and can silently fail to
// persist. A Supabase session (access JWT + refresh token + user object)
// routinely exceeds that, so on Android the session would not survive a cold
// start — the app appeared to sign the user out on every launch. iOS Keychain
// has no such limit, which is why this never surfaced there.
//
// So the value is sharded across several sub-2KB SecureStore entries. Nothing
// leaves the OS keychain (no plaintext AsyncStorage), and a value written whole
// before this change is read back transparently, so upgrading logs nobody out.
const CHUNK_SIZE = 1536;
const CHUNK_MANIFEST_PREFIX = "__sbchunks__:";
const secureOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/**
 * Delete `${key}.0`, `${key}.1`, … from `from`. With `until` set, stops at that
 * index (exclusive); otherwise stops at the first shard already gone. Best
 * effort — a stray leftover shard never breaks a later read.
 */
async function deleteShards(key: string, from: number, until?: number) {
  const cap = until ?? from + 64;
  for (let i = from; i < cap; i += 1) {
    const shardKey = `${key}.${i}`;
    if (until == null && (await SecureStore.getItemAsync(shardKey)) == null) return;
    await SecureStore.deleteItemAsync(shardKey).catch(() => {});
  }
}

const secureStorage = {
  getItem: async (key: string) => {
    const manifest = await SecureStore.getItemAsync(key);
    if (manifest == null) return null;
    // A value stored before this change was written whole — hand it back as-is;
    // the next setItem re-stores it in shards.
    if (!manifest.startsWith(CHUNK_MANIFEST_PREFIX)) return manifest;
    const count = Number.parseInt(manifest.slice(CHUNK_MANIFEST_PREFIX.length), 10);
    if (!Number.isInteger(count) || count <= 0) return null;
    // The shards are independent keychain entries, so they are read together.
    // This read sits inside supabase-js's session lock and runs on every API
    // call, so N serial round trips here is latency every request pays and time
    // the lock is held against everything else waiting on a session.
    const shards = await Promise.all(
      Array.from({ length: count }, (_, i) =>
        SecureStore.getItemAsync(`${key}.${i}`),
      ),
    );
    // A missing shard means a torn write — report the whole value as absent so
    // Supabase re-authenticates cleanly instead of loading half a session.
    if (shards.some((shard) => shard == null)) return null;
    return shards.join("");
  },
  setItem: async (key: string, value: string) => {
    const count = Math.max(1, Math.ceil(value.length / CHUNK_SIZE));
    // Write the shards before the manifest, so a crash mid-write can never leave
    // the manifest promising shards that were never stored.
    for (let i = 0; i < count; i += 1) {
      await SecureStore.setItemAsync(
        `${key}.${i}`,
        value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
        secureOptions,
      );
    }
    await SecureStore.setItemAsync(key, `${CHUNK_MANIFEST_PREFIX}${count}`, secureOptions);
    // Drop shards left over from a previously longer value.
    await deleteShards(key, count);
  },
  removeItem: async (key: string) => {
    const manifest = await SecureStore.getItemAsync(key);
    await SecureStore.deleteItemAsync(key);
    const count = manifest?.startsWith(CHUNK_MANIFEST_PREFIX)
      ? Number.parseInt(manifest.slice(CHUNK_MANIFEST_PREFIX.length), 10)
      : undefined;
    await deleteShards(key, 0, Number.isInteger(count) ? count : undefined);
  },
};

// Expo Router renders route metadata in Node while Metro prepares the native
// manifest. Calling a native SecureStore method during that pass crashes the
// dev server, so web/server rendering gets a standards-based fallback while
// iOS and Android continue to keep the session in the device keychain.
const webStorage = {
  getItem: async (key: string) =>
    typeof globalThis.localStorage === "undefined"
      ? null
      : globalThis.localStorage.getItem(key),
  setItem: async (key: string, value: string) => {
    if (typeof globalThis.localStorage !== "undefined") {
      globalThis.localStorage.setItem(key, value);
    }
  },
  removeItem: async (key: string) => {
    if (typeof globalThis.localStorage !== "undefined") {
      globalThis.localStorage.removeItem(key);
    }
  },
};

const authStorage =
  process.env.EXPO_OS === "web" ? webStorage : secureStorage;

export const supabase = createClient(
  supabaseUrl || "https://configuration-required.supabase.co",
  publishableKey || "configuration-required",
  {
    auth: {
      storage: authStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  },
);

if (process.env.EXPO_OS !== "web") {
  AppState.addEventListener("change", (state) => {
    if (state === "active") supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
