import "server-only";

import { createHmac } from "crypto";

/**
 * ICE servers for a WebRTC call, minted per request.
 *
 * STUN alone is not a production answer here. A meaningful share of Saudi
 * mobile subscribers sit behind carrier-grade NAT, where neither peer can
 * reach the other directly and the call connects, rings, and then carries no
 * audio — the worst possible failure, because everything looks like it worked.
 * TURN relays the media for those cases.
 *
 * Credentials follow coturn's REST convention (`use-auth-secret`): the
 * username is an expiry timestamp, the password is an HMAC of it under a
 * shared secret. The secret never leaves the server, and a leaked credential
 * is useless within the hour.
 */

const TTL_SECONDS = 3600;

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface IceConfig {
  iceServers: IceServer[];
  /** False when only STUN is configured — surfaced so the UI can warn. */
  relayAvailable: boolean;
}

/** Public STUN, as the discovery fallback when nothing else is configured. */
const DEFAULT_STUN = ["stun:stun.l.google.com:19302"];

export function iceConfig(label: string): IceConfig {
  const stun = (process.env.TURN_STUN_URLS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const turnUrls = (process.env.TURN_URLS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const secret = process.env.TURN_SHARED_SECRET?.trim();

  const servers: IceServer[] = [{ urls: stun.length ? stun : DEFAULT_STUN }];

  if (!turnUrls.length || !secret) {
    // Deliberately not an error: calling still works for most networks, and
    // refusing to start a call because TURN is unconfigured would be worse
    // than starting one that might not connect. The flag tells the caller.
    return { iceServers: servers, relayAvailable: false };
  }

  const username = `${Math.floor(Date.now() / 1000) + TTL_SECONDS}:${label}`;
  const credential = createHmac("sha1", secret).update(username).digest("base64");

  servers.push({ urls: turnUrls, username, credential });
  return { iceServers: servers, relayAvailable: true };
}
