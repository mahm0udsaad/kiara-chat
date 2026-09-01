"use client";

import { useEffect } from "react";

const HEARTBEAT_MS = 45_000;

function send(state: "active" | "background") {
  void fetch("/api/activity/heartbeat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state }),
    keepalive: true,
  }).catch(() => undefined);
}

/** Keeps web users visible in the same owner report as native app users. */
export function AppPresenceHeartbeat() {
  useEffect(() => {
    const current = () => (document.visibilityState === "visible" ? "active" : "background");
    send(current());
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") send("active");
    }, HEARTBEAT_MS);
    const onVisibility = () => send(current());
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      send("background");
    };
  }, []);
  return null;
}
