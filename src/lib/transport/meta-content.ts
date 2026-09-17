import {
  metaCloudConfig,
  metaGraphCall,
  type MetaCloudConfig,
} from "./meta-api";
import type {
  ApprovalStatus,
  CreateTemplateInput,
  CreatedTemplate,
  TemplateCategory,
  TemplateSummary,
} from "./twilio-content";
import {
  rememberTemplateHeaderImage,
  storedTemplateHeaderImage,
  storagePathFromSignedUrl,
} from "@/lib/template-header-images";

export const META_TEMPLATE_PREFIX = "meta:";

type MetaComponent = {
  type?: string;
  format?: string;
  text?: string;
  example?: { body_text?: string[][]; header_handle?: string[] };
  buttons?: Array<{
    type?: string;
    text?: string;
    url?: string;
    phone_number?: string;
  }>;
};

interface MetaTemplateRow {
  id?: string;
  name: string;
  language: string;
  category?: string;
  status?: string;
  rejected_reason?: string;
  components?: MetaComponent[];
}

function encodeIdentifier(name: string, language: string): string {
  return `${META_TEMPLATE_PREFIX}${name}:${language}`;
}

export function parseMetaTemplateIdentifier(
  identifier: string,
): { name: string; language: string } | null {
  if (!identifier.startsWith(META_TEMPLATE_PREFIX)) return null;
  const value = identifier.slice(META_TEMPLATE_PREFIX.length);
  const split = value.lastIndexOf(":");
  if (split <= 0) return null;
  const name = value.slice(0, split);
  const language = value.slice(split + 1);
  return name && language ? { name, language } : null;
}

function approvalStatus(status: string | undefined): ApprovalStatus {
  switch ((status ?? "").toUpperCase()) {
    case "APPROVED":
      return "approved";
    case "REJECTED":
    case "DISABLED":
      return "rejected";
    case "PENDING":
    case "IN_APPEAL":
    case "PAUSED":
      return "pending";
    default:
      return "received";
  }
}

function toSummary(row: MetaTemplateRow): TemplateSummary {
  const components = row.components ?? [];
  const body = components.find((component) => component.type === "BODY")?.text ?? "";
  const header = components.find((component) => component.type === "HEADER");
  const buttons =
    components
      .find((component) => component.type === "BUTTONS")
      ?.buttons?.map((button) => button.text?.trim() ?? "")
      .filter(Boolean) ?? [];
  const variableKeys = new Set<string>();
  for (const match of body.matchAll(/\{\{(\d+)\}\}/g)) variableKeys.add(match[1]);
  return {
    sid: encodeIdentifier(row.name, row.language),
    name: row.name,
    language: row.language,
    contentType:
      header?.format === "IMAGE"
        ? "media"
        : buttons.length
          ? components
              .find((component) => component.type === "BUTTONS")
              ?.buttons?.some((button) => button.type === "QUICK_REPLY")
            ? "quick_reply"
            : "call_to_action"
          : "text",
    category: (row.category as TemplateCategory) ?? null,
    status: approvalStatus(row.status),
    rejectionReason: row.rejected_reason || null,
    body,
    buttons,
    variableKeys: [...variableKeys].sort((a, b) => Number(a) - Number(b)),
    dateCreated: null,
  };
}

export async function listMetaTemplatesWithStatus(): Promise<TemplateSummary[]> {
  const { wabaId } = metaCloudConfig();
  if (!wabaId) throw new Error("Meta Cloud API is not configured: missing WABA ID");
  const rows: TemplateSummary[] = [];
  let path: string | null = `/${wabaId}/message_templates?limit=100&fields=id,name,language,status,category,rejected_reason,components`;
  while (path) {
    const page: {
      data?: MetaTemplateRow[];
      paging?: { next?: string; cursors?: { after?: string } };
    } = await metaGraphCall(path);
    rows.push(...(page.data ?? []).map(toSummary));
    const after = page.paging?.cursors?.after;
    path = page.paging?.next && after
      ? `/${wabaId}/message_templates?limit=100&fields=id,name,language,status,category,rejected_reason,components&after=${encodeURIComponent(after)}`
      : null;
  }
  return rows;
}

const HEADER_IMAGE_TTL_MS = 5 * 60_000;
const headerImageCache = new Map<string, { at: number; link: string | null }>();

/**
 * A template approved with a media header must carry that media on every send
 * or Meta rejects the whole message. The image it was approved with is the
 * right one to resend, so read it back from the template itself rather than
 * making every caller configure a URL. Cached because a broadcast resolves the
 * same template once per recipient.
 *
 * Meta returns `header_handle` as an upload handle at create time but as a
 * fetchable URL on read-back, so anything that is not an http(s) URL is no use
 * to us as a `link` and is treated as absent.
 */
export async function metaTemplateHeaderImage(
  name: string,
  language: string,
): Promise<string | null> {
  const key = `${name}:${language}`;
  const cached = headerImageCache.get(key);
  if (cached && Date.now() - cached.at < HEADER_IMAGE_TTL_MS) return cached.link;

  // The template itself decides whether there is a header to fill. The
  // stored image and the env override used to be returned first, so a
  // text-only template went out with an image header and Meta refused the
  // whole send: "132018 header: Template does not contain title component".
  const { wabaId } = metaCloudConfig();
  if (!wabaId) throw new Error("Meta Cloud API is not configured: missing WABA ID");
  const page: { data?: MetaTemplateRow[] } = await metaGraphCall(
    `/${wabaId}/message_templates?limit=50&fields=name,language,components&name=${encodeURIComponent(name)}`,
  );
  const row = (page.data ?? []).find(
    (candidate) => candidate.name === name && candidate.language === language,
  );
  const header = (row?.components ?? []).find((component) => component.type === "HEADER");
  if (header?.format !== "IMAGE") {
    headerImageCache.set(key, { at: Date.now(), link: null });
    return null;
  }

  // The image the template was created with in Kiara is authoritative; the
  // env override predates per-template images and would put one template's
  // picture on another's message.
  const handle = header.example?.header_handle?.[0]?.trim();
  const link =
    (await storedTemplateHeaderImage(name, language)) ||
    process.env.META_TEMPLATE_HEADER_IMAGE_URL?.trim() ||
    (handle && /^https?:\/\//i.test(handle) ? handle : null);
  headerImageCache.set(key, { at: Date.now(), link });
  return link;
}

/** Resolve old Twilio HX identifiers against names Meta retained during migration. */
export async function resolveMetaTemplateIdentifier(
  identifier: string,
): Promise<{ name: string; language: string }> {
  const parsed = parseMetaTemplateIdentifier(identifier);
  if (parsed) return parsed;

  if (/^HX[a-zA-Z0-9]{32}$/.test(identifier)) {
    const suffix = `_${identifier.toLowerCase()}`;
    const match = (await listMetaTemplatesWithStatus()).find((template) =>
      template.name.toLowerCase().endsWith(suffix),
    );
    if (match) return { name: match.name, language: match.language };
  }

  if (/^[a-z0-9_]{1,512}$/.test(identifier)) {
    return { name: identifier, language: "ar" };
  }
  throw new Error("META_TEMPLATE_NOT_FOUND: approved template could not be resolved");
}

function positionalExamples(input: CreateTemplateInput): string[] {
  const keys = [...input.body.matchAll(/\{\{(\d+)\}\}/g)]
    .map((match) => match[1])
    .filter((key, index, all) => all.indexOf(key) === index)
    .sort((a, b) => Number(a) - Number(b));
  return keys.map((key) => input.variables?.[key]?.trim() || `example ${key}`);
}

async function uploadHeaderHandle(
  url: string,
  config: MetaCloudConfig,
): Promise<string> {
  if (!config.appId) throw new Error("META_TEMPLATE_MEDIA: missing META_CLOUD_APP_ID");
  const media = await fetch(url, { cache: "no-store" });
  if (!media.ok) throw new Error(`META_TEMPLATE_MEDIA: sample download HTTP ${media.status}`);
  const bytes = Buffer.from(await media.arrayBuffer());
  const contentType = media.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  const fileName = new URL(url).pathname.split("/").pop() || "template-image.jpg";
  const session = await metaGraphCall<{ id?: string }>(
    `/${config.appId}/uploads?file_name=${encodeURIComponent(fileName)}&file_length=${bytes.byteLength}&file_type=${encodeURIComponent(contentType)}`,
    { method: "POST" },
  );
  if (!session.id) throw new Error("META_TEMPLATE_MEDIA: upload session was not created");
  const uploaded = await metaGraphCall<{ h?: string }>(`/${session.id}`, {
    method: "POST",
    headers: { file_offset: "0", "Content-Type": contentType },
    body: bytes,
  });
  if (!uploaded.h) throw new Error("META_TEMPLATE_MEDIA: Meta did not return a header handle");
  return uploaded.h;
}

export async function createMetaTemplate(
  input: CreateTemplateInput,
): Promise<CreatedTemplate> {
  const config = metaCloudConfig();
  if (!config.wabaId) throw new Error("Meta Cloud API is not configured: missing WABA ID");

  const examples = positionalExamples(input);
  const components: Record<string, unknown>[] = [];
  if (input.contentType === "media") {
    if (!input.mediaUrl) throw new Error("META_TEMPLATE_MEDIA: image sample is required");
    const handle = await uploadHeaderHandle(input.mediaUrl, config);
    components.push({
      type: "HEADER",
      format: "IMAGE",
      example: { header_handle: [handle] },
    });
  }
  components.push({
    type: "BODY",
    text: input.body,
    ...(examples.length ? { example: { body_text: [examples] } } : {}),
  });
  if (input.contentType === "quick_reply") {
    components.push({
      type: "BUTTONS",
      buttons: (input.quickReplies ?? []).map((button) => ({
        type: "QUICK_REPLY",
        text: button.title,
      })),
    });
  }
  if (input.contentType === "call_to_action") {
    components.push({
      type: "BUTTONS",
      buttons: (input.ctaButtons ?? []).map((button) =>
        button.type === "URL"
          ? { type: "URL", text: button.title, url: button.url }
          : { type: "PHONE_NUMBER", text: button.title, phone_number: button.phone },
      ),
    });
  }

  const result = await metaGraphCall<{ id?: string; status?: string; category?: string }>(
    `/${config.wabaId}/message_templates`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: input.name,
        language: input.language,
        category: input.category ?? "MARKETING",
        allow_category_change: true,
        components,
      }),
    },
  );
  if (!result.id) throw new Error("Meta did not return a template id");
  const headerPath =
    input.contentType === "media" && input.mediaUrl
      ? storagePathFromSignedUrl(input.mediaUrl)
      : null;
  if (headerPath) await rememberTemplateHeaderImage(input.name, input.language, headerPath);
  return { sid: encodeIdentifier(input.name, input.language), name: input.name };
}
