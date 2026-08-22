/**
 * Does the salon's Rekaz login actually work?
 *
 * Rekaz closed anonymous reads of /api/app/reservation on 2026-08-22 — it now
 * answers 401 with `www-authenticate: Bearer`. `src/lib/rekaz-auth.ts` logs in
 * on the server to get past that, but a wrong password there surfaces as a
 * banner on a phone, which is a slow way to find out. This script asks the same
 * two questions the library asks, in the same order, and prints what happened:
 *
 *   1. Does /connect/token issue a token for these credentials?
 *   2. If not, does /api/account/login return an identity cookie?
 *   3. Either way — does the reservation endpoint then answer?
 *
 *   node --env-file=.env.local scripts/rekaz-login-check.mjs
 *
 * Reads REKAZ_USERNAME / REKAZ_PASSWORD / REKAZ_CLIENT_ID / REKAZ_SCOPE /
 * REKAZ_TENANT_ID from the environment. Prints no secrets.
 */

const PLATFORM = "https://platform.rekaz.io";
const TENANT =
  process.env.REKAZ_TENANT_ID ?? "3a1f3638-e6dc-d864-4aa7-df60cdbb1146";
const USERNAME = process.env.REKAZ_USERNAME?.trim() ?? "";
const PASSWORD = process.env.REKAZ_PASSWORD ?? "";
const CLIENT_ID = process.env.REKAZ_CLIENT_ID?.trim() ?? "";
const SCOPE = process.env.REKAZ_SCOPE?.trim() || "Platform offline_access";

if (!USERNAME || !PASSWORD) {
  console.error(
    "REKAZ_USERNAME and REKAZ_PASSWORD are not set — nothing to check.",
  );
  process.exit(1);
}

console.log(`tenant   ${TENANT}`);
console.log(`user     ${USERNAME.replace(/(.{2}).*(@.*)?$/, "$1***$2")}`);
console.log(`client   ${CLIENT_ID || "(public — no client_id sent)"}`);
console.log(`scope    ${SCOPE}\n`);

/** Step 1 — the OpenIddict password grant. */
async function tokenGrant() {
  const body = new URLSearchParams({
    grant_type: "password",
    username: USERNAME,
    password: PASSWORD,
    scope: SCOPE,
  });
  if (CLIENT_ID) body.set("client_id", CLIENT_ID);

  const res = await fetch(`${PLATFORM}/connect/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      __tenant: TENANT,
    },
    body,
  });
  const payload = await res.json().catch(() => ({}));

  if (res.ok && payload.access_token) {
    console.log(
      `1. /connect/token   ✓ token issued (expires in ${payload.expires_in ?? "?"}s` +
        `${payload.refresh_token ? ", refresh token included" : ", no refresh token"})`,
    );
    return { Authorization: `Bearer ${payload.access_token}` };
  }

  console.log(
    `1. /connect/token   ✗ ${res.status} ${payload.error ?? ""} — ${
      payload.error_description ?? "no detail"
    }`,
  );
  return null;
}

/** Step 2 — ABP's cookie login. */
async function cookieLogin() {
  const res = await fetch(`${PLATFORM}/api/account/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Requested-With": "XMLHttpRequest",
      __tenant: TENANT,
    },
    body: JSON.stringify({
      userNameOrEmailAddress: USERNAME,
      password: PASSWORD,
      rememberMe: true,
    }),
    redirect: "manual",
  });
  const payload = await res.json().catch(() => ({}));
  const cookie = (res.headers.getSetCookie?.() ?? [])
    .map((line) => line.split(";")[0]?.trim() ?? "")
    .filter((pair) => pair.includes("=") && !pair.endsWith("="))
    .join("; ");

  if (res.ok && cookie) {
    console.log(`2. /api/account/login   ✓ signed in (result ${payload.result ?? "?"})`);
    return { Cookie: cookie };
  }

  console.log(
    `2. /api/account/login   ✗ ${res.status} — ${
      payload.error?.message ?? payload.description ?? "no detail"
    }`,
  );
  return null;
}

/** Step 3 — the endpoint everything actually depends on. */
async function readReservations(auth) {
  const url = new URL(`${PLATFORM}/api/app/reservation`);
  url.searchParams.set("MaxResultCount", "1");
  url.searchParams.set("SkipCount", "0");
  url.searchParams.set("Sorting", "date desc");

  const res = await fetch(url, {
    headers: {
      "X-Requested-With": "XMLHttpRequest",
      __tenant: TENANT,
      Accept: "application/json",
      ...auth,
    },
  });

  if (!res.ok) {
    console.log(`3. /api/app/reservation   ✗ ${res.status}`);
    return false;
  }
  const body = await res.json().catch(() => ({}));
  console.log(
    `3. /api/app/reservation   ✓ ${res.status} — ${body.totalCount ?? "?"} reservations visible`,
  );
  return true;
}

const auth = (await tokenGrant()) ?? (await cookieLogin());
if (!auth) {
  console.error("\nNeither mechanism accepted these credentials.");
  process.exit(1);
}

const ok = await readReservations(auth);
console.log(
  ok
    ? "\nRekaz is reachable with these credentials — set them in Vercel too."
    : "\nLogin succeeded but the reservation endpoint still refused: the account may lack the reservations permission in Rekaz.",
);
process.exit(ok ? 0 : 1);
