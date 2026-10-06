import Constants from "expo-constants";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect } from "react";
import { AppState, Keyboard } from "react-native";

import { apiRequest } from "@/lib/api";

const HEARTBEAT_MS = 45_000;
/**
 * A conversation counts as being worked only while someone is actually at it:
 * a touch or the keyboard inside this window. A thread left open on a phone
 * that is not being used is app time, not chat time.
 */
const CHAT_IDLE_MS = 3 * 60_000;

/** Only operations staff report presence; set by the tabs layout. */
let presenceEnabled = false;
let chatOpen = false;
let lastInteractionAt = 0;

function screen(): "chat" | "other" {
  return chatOpen && Date.now() - lastInteractionAt <= CHAT_IDLE_MS ? "chat" : "other";
}

function send(state: "active" | "background") {
  return apiRequest<{ receivedAt: string }>("/activity/heartbeat", {
    method: "POST",
    body: JSON.stringify({
      state,
      screen: screen(),
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

/** A touch or keystroke in an open conversation: she is working it. */
export function markChatInteraction() {
  lastInteractionAt = Date.now();
}

/**
 * Marks the conversation screen as open while it is focused.
 *
 * Entering and leaving are boundaries, so each sends a beat at once: the
 * server credits every gap to the screen of the beat that started it, and a
 * beat on the boundary keeps the list's time out of chat time and the chat's
 * tail inside it.
 */
export function useChatScreenPresence() {
  useFocusEffect(
    useCallback(() => {
      chatOpen = true;
      lastInteractionAt = Date.now();
      if (presenceEnabled && AppState.currentState === "active") void send("active");
      // Typing happens on the keyboard, which no screen touch reports.
      const typing = Keyboard.addListener("keyboardDidShow", markChatInteraction);
      return () => {
        typing.remove();
        chatOpen = false;
        if (presenceEnabled && AppState.currentState === "active") void send("active");
      };
    }, []),
  );
}

/** Recent authenticated heartbeats are the report's definition of online. */
export function useEmployeePresence(enabled: boolean) {
  useEffect(() => {
    presenceEnabled = enabled;
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
      if (state === "active") {
        // Coming back to an open conversation is picking it up again.
        if (chatOpen) markChatInteraction();
        void send("active");
      } else void leave();
    });
    return () => {
      presenceEnabled = false;
      clearInterval(timer);
      subscription.remove();
      void leave();
    };
  }, [enabled]);
}
