/**
 * Phase 0 of WhatsApp calling: prove what the account actually allows.
 *
 * Every calling fact this project plans against came from documentation, not
 * from the account. This script reads the real state off the Graph API and,
 * with --apply, turns on the three settings calling needs.
 *
 * Read-only by default. Nothing here sends a message or places a call.
 *
 * Usage:
 *   # 1. Report current state (safe, read-only):
 *   node --env-file=.env.local scripts/check-calling-setup.mjs
 *
 *   # 2. Enable calling, subscribe the `calls` webhook, allow callback permission:
 *   node --env-file=.env.local scripts/check-calling-setup.mjs --apply
 *
 *   # 3. Also read the live permission state for one customer:
 *   node --env-file=.env.local scripts/check-calling-setup.mjs --phone=+966501234567
 *
 * Requires META_CLOUD_ACCESS_TOKEN in .env.local. The production token is a
 * Vercel Secret and cannot be pulled with `vercel env pull` — copy it from the
 * Meta app dashboard, or run this against a token with whatsapp_business_
 * management + whatsapp_business_messaging on the Kiara WABA.
 */

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const phoneArg = args.find((a) => a.startsWith("--phone="))?.split("=")[1]?.trim();

const GRAPH_VERSION = process.env.META_CLOUD_GRAPH_VERSION?.trim() || "v26.0";
const TOKEN = process.env.META_CLOUD_ACCESS_TOKEN?.trim();
const PHONE_NUMBER_ID = process.env.META_CLOUD_PHONE_NUMBER_ID?.trim();
const WABA_ID = process.env.META_CLOUD_WABA_ID?.trim();

const RESET = "\x1b[0m";
const paint = (code, text) => `\x1b[${code}m${text}${RESET}`;
const ok = (t) => paint("32", t);
const bad = (t) => paint("31", t);
const warn = (t) => paint("33", t);
const dim = (t) => paint("90", t);

if (!TOKEN || TOKEN === "[SENSITIVE]") {
  console.error(
    bad("✗ META_CLOUD_ACCESS_TOKEN is missing or redacted.") +
      "\n  The production value is a Vercel Secret and cannot be pulled." +
      "\n  Put a real token in .env.local before running this.",
  );
  process.exit(1);
}
if (!PHONE_NUMBER_ID || !WABA_ID) {
  console.error(bad("✗ META_CLOUD_PHONE_NUMBER_ID and META_CLOUD_WABA_ID are both required."));
  process.exit(1);
}

async function graph(path, init = {}) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(init.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    const e = data.error || {};
    const detail = e.error_data?.details || e.message || `HTTP ${response.status}`;
    throw new Error(`${e.code ?? response.status}: ${detail}`);
  }
  return data;
}

/** Report a check without letting one failure end the run. */
async function step(label, fn) {
  try {
    return await fn();
  } catch (error) {
    console.log(`${bad("✗")} ${label}\n  ${dim(error.message)}`);
    return null;
  }
}

console.log(`\n${paint("1", "WhatsApp calling — account readiness")}`);
console.log(dim(`  graph ${GRAPH_VERSION} · phone ${PHONE_NUMBER_ID} · waba ${WABA_ID}`));
console.log(dim(`  mode: ${apply ? "APPLY (will write settings)" : "read-only"}\n`));

// ── 1. Is calling switched on for the business number? ──────────────────────
const settings = await step("Read phone number settings", () =>
  graph(`/${PHONE_NUMBER_ID}/settings`),
);
const calling = settings?.calling ?? null;
if (calling) {
  const status = String(calling.status ?? "UNKNOWN").toUpperCase();
  console.log(
    `${status === "ENABLED" ? ok("✓") : warn("•")} Calling status: ${status}`,
  );
  console.log(
    `  ${dim("call_icon_visibility")}       ${calling.call_icon_visibility ?? dim("unset")}`,
  );
  console.log(
    `  ${dim("callback_permission_status")} ${calling.callback_permission_status ?? dim("unset")}` +
      (calling.callback_permission_status === "ENABLED"
        ? ""
        : warn("  ← free permission when a customer calls first")),
  );
  console.log(
    `  ${dim("call_hours")}                 ${calling.call_hours?.status ?? dim("unset")}`,
  );
  console.log(
    `  ${dim("sip")}                        ${calling.sip?.status ?? dim("unset")}` +
      (calling.sip?.status === "ENABLED"
        ? bad("  ← SIP is ON: the Graph calling endpoints are disabled")
        : ""),
  );
} else if (settings) {
  console.log(`${warn("•")} No \`calling\` object on the number — never configured.`);
}

// ── 2. Is the `calls` webhook field subscribed? ─────────────────────────────
const subscribed = await step("Read subscribed webhook fields", () =>
  graph(`/${WABA_ID}/subscribed_apps`),
);
if (subscribed) {
  const app = subscribed.data?.[0];
  const fields = (app?.subscribed_fields ?? []).map(String);
  const has = (f) => fields.includes(f);
  console.log(
    `${has("messages") ? ok("✓") : bad("✗")} \`messages\` subscribed ` +
      dim("(this is the live customer inbox — must stay on)"),
  );
  console.log(`${has("calls") ? ok("✓") : warn("•")} \`calls\` subscribed`);
  if (fields.length) console.log(dim(`  all fields: ${fields.join(", ")}`));
}

// ── 3. Messaging limit — calling requires at least 2,000/24h. ──────────────
const number = await step("Read number quality and throughput", () =>
  graph(
    `/${PHONE_NUMBER_ID}?fields=display_phone_number,verified_name,quality_rating,throughput,messaging_limit_tier`,
  ),
);
if (number) {
  const tier = number.messaging_limit_tier ?? "unknown";
  const enough = /1K/i.test(String(tier)) === false && tier !== "unknown";
  console.log(
    `${enough ? ok("✓") : warn("•")} Messaging limit tier: ${tier} ` +
      dim("(calling needs ≥ 2,000 unique recipients / 24h)"),
  );
  console.log(
    dim(
      `  ${number.display_phone_number ?? "?"} · ${number.verified_name ?? "?"} · quality ${number.quality_rating ?? "?"}`,
    ),
  );
}

// ── 4. Live permission state for one customer, if asked. ───────────────────
if (phoneArg) {
  const waId = phoneArg.replace(/\D/g, "");
  const permission = await step(`Read call permission for ${phoneArg}`, () =>
    graph(`/${PHONE_NUMBER_ID}/call_permissions?user_wa_id=${waId}`),
  );
  if (permission) {
    console.log(`${ok("✓")} Permission state for ${phoneArg}:`);
    console.log(dim(JSON.stringify(permission, null, 2).split("\n").map((l) => `  ${l}`).join("\n")));
  }
}

// ── 5. Apply the three settings calling needs. ─────────────────────────────
if (apply) {
  console.log(`\n${paint("1", "Applying settings")}`);

  // Order matters, and not in the obvious way: Meta refuses to enable
  // calling on a number that has no calls webhook subscribed, with
  // error 2593151 ("you need to configure webhooks or set up Session
  // Initiation Protocol"). Subscribing first, enabling second.
  await step("Subscribe the `calls` webhook field", async () => {
    // Re-subscribing the app replaces its field set, so `messages` is listed
    // explicitly alongside `calls`. Omitting it here would silence the live
    // customer inbox.
    const current = await graph(`/${WABA_ID}/subscribed_apps`);
    const existing = new Set(
      (current.data?.[0]?.subscribed_fields ?? []).map(String),
    );
    existing.add("messages");
    existing.add("calls");
    await graph(`/${WABA_ID}/subscribed_apps`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscribed_fields: [...existing] }),
    });
    console.log(`${ok("✓")} subscribed fields: ${[...existing].join(", ")}`);
  });

  // Deliberately does not touch `sip`. Enabling SIP disables every Graph
  // calling endpoint this project is built on, and is a one-way door on the
  // spa's only production number — it must never be a side effect of a setup
  // script.
  await step("Enable calling + callback permission", async () => {
    await graph(`/${PHONE_NUMBER_ID}/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        calling: {
          status: "ENABLED",
          call_icon_visibility: "DEFAULT",
          callback_permission_status: "ENABLED",
        },
      }),
    });
    console.log(`${ok("✓")} calling.status = ENABLED, callback_permission_status = ENABLED`);
  });

  console.log(dim("\n  Re-run without --apply to confirm the new state."));
} else {
  console.log(dim("\n  Read-only. Re-run with --apply to enable calling and subscribe `calls`."));
}

console.log(
  dim(
    "\n  Not checked here: the per-minute rate. Read it from WhatsApp Manager →\n" +
      "  Insights → Calling pricing, and treat that as the number of record.\n",
  ),
);
