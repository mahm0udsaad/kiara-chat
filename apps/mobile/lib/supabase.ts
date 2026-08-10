import "react-native-url-polyfill/auto";

import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { AppState } from "react-native";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? "";
const publishableKey =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";

export const isSupabaseConfigured = Boolean(supabaseUrl && publishableKey);

const secureStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) =>
    SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
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
