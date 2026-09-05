/**
 * Twilio Content API client — create WhatsApp templates, submit them for Meta
 * approval, and read their status back.
 *
 * This is a different host from the messaging API (content.twilio.com vs
 * api.twilio.com) but the same account credentials. It is the mechanism behind
 * self-service templates: staff author a template in the app instead of the
 * Twilio console, and its approval status is read live from
 * `/ContentAndApprovals` so it can never drift from what Meta actually decided.
 */
const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID?.trim();
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN?.trim();
const API_KEY_SID = process.env.TWILIO_API_KEY_SID?.trim();
const API_KEY_SECRET = process.env.TWILIO_API_KEY_SECRET?.trim();

const ROOT = "https://content.twilio.com/v1";
const TIMEOUT_MS = 15_000;

export function isContentApiConfigured(): boolean {
  return Boolean(ACCOUNT_SID && AUTH_TOKEN);
}

function authHeader(): string {
  const useKey = Boolean(API_KEY_SID && API_KEY_SECRET);
  const user = useKey ? API_KEY_SID! : ACCOUNT_SID!;
  const pass = useKey ? API_KEY_SECRET! : AUTH_TOKEN!;
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

async function call(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<unknown> {
  if (!isContentApiConfigured()) {
    throw new Error("Twilio not configured: TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${ROOT}${path}`, {
      method,
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (cause) {
    throw new Error(
      controller.signal.aborted
        ? `Twilio Content API did not respond within ${TIMEOUT_MS}ms`
        : "Twilio Content API unreachable",
      { cause },
    );
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}) as Record<string, unknown>);
  if (!res.ok) {
    const d = data as Record<string, unknown>;
    const code = d?.code ? `${d.code}` : `${res.status}`;
    const message = typeof d?.message === "string" ? d.message : "";
    throw new Error(`TWILIO_CONTENT_${code}: ${message}`.trim());
  }
  return data;
}

/** The four business-initiated marketing shapes the app lets staff author. */
export type ContentType = "text" | "media" | "quick_reply" | "call_to_action";

export interface QuickReplyButton {
  title: string;
  id: string;
}

export type CtaButton =
  | { type: "URL"; title: string; url: string }
  | { type: "PHONE_NUMBER"; title: string; phone: string };

export interface CreateTemplateInput {
  /** Lowercase alphanumeric + underscores; Twilio's friendly_name and the WA name. */
  name: string;
  language: string; // e.g. "ar"
  contentType: ContentType;
  body: string;
  /** Sample values for {{n}} variables, keyed "1", "2", … */
  variables?: Record<string, string>;
  /** media only: a publicly reachable https URL. */
  mediaUrl?: string;
  quickReplies?: QuickReplyButton[];
  ctaButtons?: CtaButton[];
}

function buildTypes(input: CreateTemplateInput): Record<string, unknown> {
  switch (input.contentType) {
    case "text":
      return { "twilio/text": { body: input.body } };
    case "media":
      return {
        "twilio/media": {
          body: input.body,
          media: input.mediaUrl ? [input.mediaUrl] : [],
        },
      };
    case "quick_reply":
      return {
        "twilio/quick-reply": {
          body: input.body,
          actions: (input.quickReplies ?? []).map((b) => ({ title: b.title, id: b.id })),
        },
      };
    case "call_to_action":
      return {
        "twilio/call-to-action": {
          body: input.body,
          actions: (input.ctaButtons ?? []).map((b) =>
            b.type === "URL"
              ? { type: "URL", title: b.title, url: b.url }
              : { type: "PHONE_NUMBER", title: b.title, phone: b.phone },
          ),
        },
      };
  }
}

export interface CreatedTemplate {
  sid: string;
  name: string;
}

export async function createTemplate(input: CreateTemplateInput): Promise<CreatedTemplate> {
  const data = (await call("POST", "/Content", {
    friendly_name: input.name,
    language: input.language,
    variables: input.variables ?? {},
    types: buildTypes(input),
  })) as { sid?: string; friendly_name?: string };
  if (!data.sid) throw new Error("Twilio did not return a content sid");
  return { sid: data.sid, name: data.friendly_name ?? input.name };
}

export type TemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION";

export async function submitForApproval(
  contentSid: string,
  name: string,
  category: TemplateCategory,
): Promise<{ status: string }> {
  const data = (await call(
    "POST",
    `/Content/${contentSid}/ApprovalRequests/whatsapp`,
    { name, category },
  )) as { status?: string };
  return { status: data.status ?? "received" };
}

export type ApprovalStatus =
  | "received"
  | "pending"
  | "approved"
  | "rejected"
  | "unsubmitted";

export interface TemplateSummary {
  sid: string;
  name: string;
  language: string;
  contentType: string; // the twilio/* type
  category: TemplateCategory | null;
  status: ApprovalStatus;
  rejectionReason: string | null;
  body: string;
  dateCreated: string | null;
}

interface ContentAndApproval {
  sid: string;
  friendly_name: string;
  language: string;
  date_created: string;
  types: Record<string, { body?: string }>;
  approval_requests?: {
    status?: string;
    category?: string;
    rejection_reason?: string;
    content_type?: string;
  } | null;
}

/**
 * List every template with its live approval status in one call — the reliable
 * way to show status, since it comes straight from Meta's decision rather than
 * anything we cached and might have gotten wrong.
 */
export async function listTemplatesWithStatus(): Promise<TemplateSummary[]> {
  const out: TemplateSummary[] = [];
  let path: string | null = "/ContentAndApprovals?PageSize=100";
  while (path) {
    const data = (await call("GET", path)) as {
      contents?: ContentAndApproval[];
      meta?: { next_page_url?: string | null };
    };
    for (const c of data.contents ?? []) {
      const twType = Object.keys(c.types ?? {})[0] ?? "twilio/text";
      const body = c.types?.[twType]?.body ?? "";
      const ar = c.approval_requests ?? null;
      out.push({
        sid: c.sid,
        name: c.friendly_name,
        language: c.language,
        contentType: twType,
        category: (ar?.category as TemplateCategory) ?? null,
        status: (ar?.status as ApprovalStatus) ?? "unsubmitted",
        rejectionReason: ar?.rejection_reason || null,
        body,
        dateCreated: c.date_created ?? null,
      });
    }
    const next = data.meta?.next_page_url ?? null;
    // next_page_url is absolute against content.twilio.com; strip the root.
    path = next ? next.replace(ROOT, "") : null;
  }
  return out;
}
