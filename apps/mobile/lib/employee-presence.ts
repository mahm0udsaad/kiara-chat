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

/**
 * Close a stretch of use, crediting the time since the last beat first.
 *
 * The server credits the gap between two consecutive *active* beats, so a
 * visit shorter than one heartbeat used to be worth nothing at all: an
 * employee who opened the app, answered a customer and left inside 45 seconds
 * sent one active beat, and the next thing the server saw was the background
 * beat, which credits nothing. Days of real work came out as "0 د" — جنات had
 * three visits spanning eight hours and zero credited minutes.
 *
 * Sending one last active beat on the way out closes that gap: the server
 * credits the seconds since the previous beat, then the background beat ends
 * the stretch as before. Nothing is over-counted, because the credit is still
 * bounded by the server's idle cutoff.
 */
async function leave() {
  await send("active");
  await send("background");
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
      // Only a real backgrounding closes a stretch of use. iOS also reports
      // "inactive" for every transient interruption — a notification banner,
      // the app switcher, a swipe of control centre — and treating those as
      // background ended the stretch each time, which threw away the minutes
      // around them, and counted hundreds of "sessions" in a day.
      if (state === "inactive") return;
      if (state === "active") void send("active");
      else void leave();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
      void leave();
    };
  }, [enabled]);
}
