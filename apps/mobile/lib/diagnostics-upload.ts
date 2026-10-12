/**
 * Sends what `diagnostics` recorded to the server.
 *
 * Runs on a module-level timer rather than inside a provider: the error screen
 * replaces the whole React tree, providers included, and that is precisely the
 * moment a report most needs to go out.
 */
import { AppState, Platform } from "react-native";

import { apiRequest } from "@/lib/api";
import {
  diagnosticsDevice,
  returnDiagnostics,
  takeDiagnostics,
} from "@/lib/diagnostics";
import { rememberedAccessToken } from "@/lib/supabase";

const SEND_EVERY_MS = 60_000;

let started = false;
let sending = false;

export async function sendDiagnostics(closing = false) {
  // Signed out, there is nobody to report as; the events wait for the next
  // session rather than forcing a token refresh of their own.
  if (sending || !rememberedAccessToken()) return;
  const events = takeDiagnostics(closing);
  if (!events.length) return;
  sending = true;
  try {
    await apiRequest<{ saved: number }>("/diagnostics", {
      method: "POST",
      body: JSON.stringify({ device: diagnosticsDevice(), events }),
      timeoutMs: 10_000,
    });
  } catch {
    returnDiagnostics(events);
  } finally {
    sending = false;
  }
}

export function startDiagnosticsUpload() {
  if (started || Platform.OS === "web") return;
  started = true;
  setInterval(() => void sendDiagnostics(), SEND_EVERY_MS);
  AppState.addEventListener("change", (state) => {
    if (state !== "active") void sendDiagnostics(true);
  });
}
