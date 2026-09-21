"use client";

import { useEffect } from "react";

const HEARTBEAT_MS = 45_000;

function send(state: "active" | "background") {
  return fetch("/api/activity/heartbeat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state }),
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
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      void leave();
    };
  }, []);
  return null;
}
