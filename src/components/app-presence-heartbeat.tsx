"use client";

import { useEffect } from "react";

const HEARTBEAT_MS = 45_000;
/**
 * A conversation counts as being worked only while someone is actually at it:
 * a click, a key or a scroll inside this window. An inbox left open on a desk
 * all afternoon is app time, not chat time.
 */
const CHAT_IDLE_MS = 3 * 60_000;

let lastInteractionAt = 0;

/** The inbox flags `<html data-thread="open">` whenever a conversation is open. */
function screen(): "chat" | "other" {
  const threadOpen = document.documentElement.dataset.thread === "open";
  return threadOpen && Date.now() - lastInteractionAt <= CHAT_IDLE_MS ? "chat" : "other";
}

function send(state: "active" | "background") {
  return fetch("/api/activity/heartbeat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state, screen: screen() }),
    keepalive: true,
  }).catch(() => undefined);
}

/**
 * Close a stretch of use, crediting the time since the last beat first.
 *
 * The server credits the gap between two consecutive active beats, so a visit
 * shorter than one heartbeat was worth nothing: the tail between the last beat
 * and leaving the tab was never counted. One last active beat closes it, still
 * bounded by the server's idle cutoff, and the background beat then ends the
 * stretch as before.
 */
async function leave() {
  await send("active");
  await send("background");
}

/** Keeps web users visible in the same owner report as native app users. */
export function AppPresenceHeartbeat() {
  useEffect(() => {
    if (document.visibilityState === "visible") void send("active");
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void send("active");
    }, HEARTBEAT_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void send("active");
      else void leave();
    };
    document.addEventListener("visibilitychange", onVisibility);

    const onInteraction = () => {
      lastInteractionAt = Date.now();
    };
    const interactions = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    for (const name of interactions) {
      document.addEventListener(name, onInteraction, { passive: true, capture: true });
    }

    // Opening or closing a conversation is a boundary: beat at once. The
    // server credits each gap to the screen of the beat that started it, so
    // this beat closes the previous stretch on the right screen and reports
    // the new one.
    let wasOpen = document.documentElement.dataset.thread === "open";
    const observer = new MutationObserver(() => {
      const open = document.documentElement.dataset.thread === "open";
      if (open === wasOpen) return;
      wasOpen = open;
      if (open) lastInteractionAt = Date.now();
      if (document.visibilityState === "visible") void send("active");
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-thread"] });

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      for (const name of interactions) {
        document.removeEventListener(name, onInteraction, { capture: true });
      }
      observer.disconnect();
      void leave();
    };
  }, []);
  return null;
}
