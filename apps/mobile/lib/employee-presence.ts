import Constants from "expo-constants";
import { useEffect } from "react";
import { AppState } from "react-native";

import { apiRequest } from "@/lib/api";

const HEARTBEAT_MS = 45_000;

function send(state: "active" | "background") {
  return apiRequest<{ receivedAt: string }>("/activity/heartbeat", {
    method: "POST",
    body: JSON.stringify({
      state,
      platform: process.env.EXPO_OS === "ios" ? "ios" : "android",
      appVersion: Constants.expoConfig?.version ?? null,
    }),
  }).catch(() => undefined);
}

/** Recent authenticated heartbeats are the report's definition of online. */
export function useEmployeePresence(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    if (AppState.currentState === "active") void send("active");
    const timer = setInterval(() => {
      if (AppState.currentState === "active") void send("active");
    }, HEARTBEAT_MS);
    const subscription = AppState.addEventListener("change", (state) => {
      void send(state === "active" ? "active" : "background");
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
      void send("background");
    };
  }, [enabled]);
}
