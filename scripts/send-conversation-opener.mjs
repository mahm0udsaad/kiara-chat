/**
 * Send approved WhatsApp template (such as `open_conversation` / `number_notice` / `conversation_opener`)
 * to all eligible Kiara customers or a specific test number.
 *
 * Safe & Idempotent:
 *   - Skips customers who have already received this template (`customer.metadata.broadcasts[templateKey].status === 'sent'`).
 *   - Rate limited with configurable delays between sends.
 *   - Supports dry-run and single-number test sending (even for unlisted test numbers).
 *
 * Usage Examples:
 *   # 1. Dry run preview (Shows audience size, sent count, pending count, and message preview):
 *   node --env-file=.env.local scripts/send-conversation-opener.mjs
 *
 *   # 2. Test send to a single specific phone number:
 *   node --env-file=.env.local scripts/send-conversation-opener.mjs --apply --phone=+201157337829
 *
 *   # 3. Send to a test batch of 50 customers:
 *   node --env-file=.env.local scripts/send-conversation-opener.mjs --apply --limit=50
 *
 *   # 4. Send to all remaining pending customers:
 *   node --env-file=.env.local scripts/send-conversation-opener.mjs --apply
 *
 *   # Optional flags:
 *   #   --template=open_conversation | conversation_opener | number_notice (default: open_conversation)
 *   #   --sync                       Sync recent reservations first
 *   #   --delay-ms=500               Delay between WhatsApp sends in milliseconds
 *   #   --limit=N                    Maximum sends in this run
 */

import { createClient } from "@supabase/supabase-js";

const KIARA_RESTAURANT_ID = process.env.KIARA_RESTAURANT_ID || "2ba8f6c8-aff9-4147-8f13-cdcb732de698";

// Parse CLI arguments
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const doSync = args.includes("--sync");
const phoneArg = args.find((a) => a.startsWith("--phone="))?.split("=")[1]?.trim();
const limitArg = args.find((a) => a.startsWith("--limit="))?.split("=")[1];
const delayArg = args.find((a) => a.startsWith("--delay-ms="))?.split("=")[1];
const templateArg = args.find((a) => a.startsWith("--template="))?.split("=")[1]?.trim() || "open_conversation";

const TEMPLATE_KEY = templateArg;
const limit = limitArg ? parseInt(limitArg, 10) : Infinity;
const delayMs = delayArg ? parseInt(delayArg, 10) : 500;

const TEMPLATES = {
  open_conversation: {
    label: "open_conversation (تنويه الرقم)",
    body: "📢 تنويه مهم لعملائنا الكرام 🤍\n\nفي حال كان رقم الواتساب الخاص بكيارا لا يظهر لديكم أو لا يعمل بشكل صحيح، نرجو منكم حذف الرقم من جهات الاتصال في جوالكم ثم إعادة حفظه من جديد.\n\n📱 رقم كيارا سبا:\n966508421748\n\nبعد إعادة حفظ الرقم، افتحوا الواتساب من جديد وسيظهر لكم الحساب بإذن الله 🤍\n\nشاكرين لكم تفهّمكم وصبركم، ونسعد دائمًا بخدمتكم 🌿\nKiara Spa | كيارا سبا",
    contentSid: process.env.TWILIO_CONTENT_SID_NUMBER_NOTICE || "HX9ed2953b5f75cadc488e2cd0add1292b",
    metaName: process.env.META_TEMPLATE_NAME_OPEN_CONVERSATION || "open_conversation",
    hasNameVar: false,
  },
  number_notice: {
    label: "تنويه الرقم (number_notice)",
    body: "📢 تنويه مهم لعملائنا الكرام 🤍\n\nفي حال كان رقم الواتساب الخاص بكيارا لا يظهر لديكم أو لا يعمل بشكل صحيح، نرجو منكم حذف الرقم من جهات الاتصال في جوالكم ثم إعادة حفظه من جديد.\n\n📱 رقم كيارا سبا:\n966508421748\n\nبعد إعادة حفظ الرقم، افتحوا الواتساب من جديد وسيظهر لكم الحساب بإذن الله 🤍\n\nشاكرين لكم تفهّمكم وصبركم، ونسعد دائمًا بخدمتكم 🌿\nKiara Spa | كيارا سبا",
    contentSid: process.env.TWILIO_CONTENT_SID_NUMBER_NOTICE || "HX9ed2953b5f75cadc488e2cd0add1292b",
    metaName: process.env.META_TEMPLATE_NAME_NUMBER_NOTICE || "open_conversation",
    hasNameVar: false,
  },
  conversation_opener: {
    label: "بدء محادثة (conversation_opener)",
    body: "السلام عليكم {{1}} 🌸\nمعكِ خدمة عملاء كيارا سبا 🍃",
    contentSid: process.env.TWILIO_CONTENT_SID_CONVERSATION_OPENER || "HX21822b343fb1d89bed64aa0ef27fcd6c",
    metaName: process.env.META_TEMPLATE_NAME_CONVERSATION_OPENER || "kiara_conversation_opener_hx21822b343fb1d89bed64aa0ef27fcd6c",
    hasNameVar: true,
  },
};

const selectedTemplate = TEMPLATES[TEMPLATE_KEY] || TEMPLATES.open_conversation;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

function normalizeDigits(phone) {
  return String(phone ?? "").replace(/\D/g, "");
}

function normalizeE164(phone) {
  let digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("05") && digits.length === 10) digits = "966" + digits.slice(1);
  if (digits.startsWith("5") && digits.length === 9) digits = "966" + digits;
  return digits.startsWith("+") ? digits : `+${digits}`;
}

function greetingName(customerName) {
  const name = (customerName ?? "").trim();
  if (!name) return "عميلتنا العزيزة";
  return name.replace(/[\r\n\t]+/g, " ").replace(/ {4,}/g, " ").trim().slice(0, 60);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Provider setup
const provider = (process.env.WHATSAPP_CUSTOMER_PROVIDER || process.env.WHATSAPP_INBOX_PROVIDER || "twilio").toLowerCase();
const twilioFrom = process.env.TWILIO_WHATSAPP_FROM || "whatsapp:+966508421748";

async function sendTwilioTemplate(toE164, sid, variables) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const apiKeySid = process.env.TWILIO_API_KEY_SID;
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;

  if (!accountSid || (!authToken && !apiKeySecret)) {
    throw new Error("Twilio credentials missing in environment.");
  }

  const authHeader = apiKeySid && apiKeySecret
    ? "Basic " + Buffer.from(`${apiKeySid}:${apiKeySecret}`).toString("base64")
    : "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64");

  const body = new URLSearchParams();
  body.set("To", `whatsapp:${toE164.replace(/^whatsapp:/, "")}`);
  body.set("From", twilioFrom.startsWith("whatsapp:") ? twilioFrom : `whatsapp:${twilioFrom}`);
  body.set("ContentSid", sid);
  if (variables && Object.keys(variables).length > 0) {
    body.set("ContentVariables", JSON.stringify(variables));
  }

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    }
  );

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Twilio send error (${res.status}): ${json.message || JSON.stringify(json)}`);
  }
  return { providerMessageId: json.sid };
}

async function sendMetaTemplate(toE164, templateName, variables) {
  const token = process.env.META_CLOUD_ACCESS_TOKEN || process.env.META_WHATSAPP_TOKEN;
  const phoneNumberId = process.env.META_CLOUD_PHONE_NUMBER_ID || process.env.META_PHONE_NUMBER_ID;
  const graphVersion = process.env.META_CLOUD_GRAPH_VERSION || "v21.0";

  if (!token || !phoneNumberId) {
    throw new Error("Meta WhatsApp credentials missing in environment (META_CLOUD_ACCESS_TOKEN or META_CLOUD_PHONE_NUMBER_ID).");
  }

  const digits = toE164.replace(/\D/g, "");
  const payload = {
    messaging_product: "whatsapp",
    to: digits,
    type: "template",
    template: {
      name: templateName,
      language: { code: "ar" },
      ...(Object.keys(variables).length > 0
        ? {
            components: [
              {
                type: "body",
                parameters: Object.keys(variables).map((k) => ({
                  type: "text",
                  text: variables[k],
                })),
              },
            ],
          }
        : {}),
    },
  };

  const res = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const json = await res.json();
  if (!res.ok || json.error) {
    const errMsg = json.error?.error_data?.details || json.error?.message || JSON.stringify(json);
    throw new Error(`Meta send error: ${errMsg}`);
  }
  return { providerMessageId: json.messages?.[0]?.id };
}

async function sendTemplate(toE164, customerName) {
  const vars = {};
  if (selectedTemplate.hasNameVar) {
    vars["1"] = greetingName(customerName);
  }

  if (provider === "meta") {
    return await sendMetaTemplate(toE164, selectedTemplate.metaName, vars);
  } else {
    return await sendTwilioTemplate(toE164, selectedTemplate.contentSid, vars);
  }
}

async function syncAudience() {
  console.log("🔄 Syncing customers from rekaz_reservations...");
  const pageSize = 1000;
  const resv = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("rekaz_reservations")
      .select("customer_phone, customer_name, arrival_at")
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    resv.push(...batch);
    if (batch.length < pageSize) break;
  }

  const booking = new Map();
  for (const r of resv) {
    const d = normalizeDigits(r.customer_phone);
    if (!d) continue;
    const entry = booking.get(d) ?? {
      phone: normalizeE164(d),
      name: r.customer_name?.trim() || null,
    };
    if (!entry.name && r.customer_name?.trim()) entry.name = r.customer_name.trim();
    booking.set(d, entry);
  }

  const toInsert = [];
  for (const [, b] of booking) {
    toInsert.push({
      restaurant_id: KIARA_RESTAURANT_ID,
      phone_number: b.phone,
      full_name: b.name,
      source: "rekaz_import",
      opted_out: false,
    });
  }

  if (toInsert.length > 0) {
    const { error } = await supabase.from("customers").upsert(toInsert, {
      onConflict: "restaurant_id,phone_number",
      ignoreDuplicates: true,
    });
    if (error) console.warn("Warning during sync upsert:", error.message);
  }
  console.log(`✅ Sync complete. Checked ${toInsert.length} reservation records.`);
}

async function main() {
  console.log("==================================================");
  console.log(`🌸 Kiara Chat - Broadcast: ${selectedTemplate.label}`);
  console.log("==================================================");
  console.log(`Provider: ${provider.toUpperCase()}`);
  console.log(`Content SID / Name: ${selectedTemplate.contentSid || selectedTemplate.metaName}`);
  console.log(`Message Preview:\n${selectedTemplate.body}`);
  console.log("--------------------------------------------------");

  if (doSync) {
    await syncAudience();
  }

  let customers = [];

  if (phoneArg) {
    const targetDigits = normalizeDigits(phoneArg);
    const targetE164 = normalizeE164(phoneArg);

    // Try finding this phone in database
    const { data } = await supabase
      .from("customers")
      .select("id, phone_number, full_name, opted_out, metadata")
      .eq("restaurant_id", KIARA_RESTAURANT_ID);

    const found = (data ?? []).find(
      (c) => normalizeDigits(c.phone_number) === targetDigits
    );

    if (found) {
      customers = [found];
    } else {
      // Create a test customer target so you can test on any phone number directly
      customers = [
        {
          id: `test-${Date.now()}`,
          phone_number: targetE164,
          full_name: "Test Customer",
          opted_out: false,
          metadata: {},
          isTest: true,
        },
      ];
    }
  } else {
    // Load all eligible customers
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase
        .from("customers")
        .select("id, phone_number, full_name, opted_out, metadata")
        .eq("restaurant_id", KIARA_RESTAURANT_ID)
        .eq("opted_out", false)
        .not("phone_number", "is", null)
        .range(from, from + pageSize - 1);

      if (error) {
        console.error("❌ Failed to load customers:", error.message);
        process.exit(1);
      }
      customers.push(...(data ?? []));
      if ((data ?? []).length < pageSize) break;
    }
  }

  // Check already sent vs pending
  const aliasKeys =
    TEMPLATE_KEY === "open_conversation" || TEMPLATE_KEY === "number_notice"
      ? ["open_conversation", "number_notice"]
      : [TEMPLATE_KEY];

  let sentCount = 0;
  let failedCount = 0;
  let pendingList = [];

  for (const c of customers) {
    if (c.isTest) {
      pendingList.push(c);
      continue;
    }
    const broadcasts = c.metadata?.broadcasts || {};
    let mark = null;
    for (const k of aliasKeys) {
      if (broadcasts[k]) {
        mark = broadcasts[k];
        break;
      }
    }

    if (mark?.status === "sent") {
      sentCount++;
    } else if (mark?.status === "failed") {
      failedCount++;
      pendingList.push(c);
    } else {
      pendingList.push(c);
    }
  }

  console.log(`📊 Audience Summary:`);
  console.log(`  • Total Targets:    ${customers.length}`);
  console.log(`  • Already Received: ${sentCount}`);
  console.log(`  • Previously Failed:${failedCount}`);
  console.log(`  • Pending to Send:  ${pendingList.length}`);
  console.log("--------------------------------------------------");

  if (!apply) {
    console.log("⚠️  DRY RUN MODE — No messages were sent.");
    console.log("");
    if (pendingList.length > 0) {
      console.log("Sample recipient(s):");
      for (const p of pendingList.slice(0, 5)) {
        console.log(`  • ${p.phone_number} (${p.full_name || "بدون اسم"})`);
      }
      console.log("");
    }
    console.log("To execute the send, run:");
    console.log("  # Test with a single number:");
    console.log(`  node --env-file=.env.local scripts/send-conversation-opener.mjs --apply --phone=+201157337829`);
    console.log("");
    console.log("  # Send to all pending customers:");
    console.log(`  node --env-file=.env.local scripts/send-conversation-opener.mjs --apply`);
    console.log("==================================================");
    return;
  }

  const toSend = pendingList.slice(0, limit);
  console.log(`🚀 Starting broadcast to ${toSend.length} recipient(s)...`);

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < toSend.length; i++) {
    const customer = toSend[i];
    const phone = normalizeE164(customer.phone_number);
    const name = customer.full_name;

    process.stdout.write(`[${i + 1}/${toSend.length}] Sending to ${phone} (${name || "no name"})... `);

    let mark;
    try {
      const res = await sendTemplate(phone, name);
      mark = {
        status: "sent",
        sid: res.providerMessageId || null,
        at: new Date().toISOString(),
      };
      successCount++;
      process.stdout.write(`✅ Sent (SID: ${res.providerMessageId || "ok"})\n`);

      // Ensure conversation and message row exist
      try {
        const { data: convData } = await supabase
          .from("conversations")
          .select("id")
          .eq("restaurant_id", KIARA_RESTAURANT_ID)
          .eq("customer_phone", phone)
          .maybeSingle();

        let conversationId = convData?.id;
        if (!conversationId) {
          const { data: newConv } = await supabase
            .from("conversations")
            .insert({
              restaurant_id: KIARA_RESTAURANT_ID,
              customer_phone: phone,
              customer_name: name || null,
              status: "active",
              started_at: new Date().toISOString(),
              last_message_at: new Date().toISOString(),
            })
            .select("id")
            .single();
          conversationId = newConv?.id;
        }

        if (conversationId && res.providerMessageId) {
          await supabase.from("messages").insert({
            conversation_id: conversationId,
            role: "agent",
            content: selectedTemplate.body,
            message_type: "template",
            external_message_sid: res.providerMessageId,
            channel: "whatsapp",
            delivery_status: "sent",
            metadata: { template: TEMPLATE_KEY, broadcast: true },
          });
        }
      } catch (cErr) {
        // non-blocking
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      mark = {
        status: "failed",
        error: errMsg.slice(0, 300),
        at: new Date().toISOString(),
      };
      errorCount++;
      process.stdout.write(`❌ Failed: ${errMsg}\n`);
    }

    // If it is a real database customer, update metadata
    if (!customer.isTest && customer.id) {
      const meta = customer.metadata || {};
      const broadcasts = meta.broadcasts || {};
      broadcasts[TEMPLATE_KEY] = mark;
      meta.broadcasts = broadcasts;

      await supabase
        .from("customers")
        .update({ metadata: meta })
        .eq("id", customer.id);
    }

    if (i < toSend.length - 1 && delayMs > 0) {
      await sleep(delayMs);
    }
  }

  console.log("==================================================");
  console.log(`🏁 Broadcast pass finished.`);
  console.log(`  • Successfully sent: ${successCount}`);
  console.log(`  • Failed:            ${errorCount}`);
  console.log(`  • Remaining pending: ${pendingList.length - toSend.length}`);
  console.log("==================================================");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
