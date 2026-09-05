import { authorizeMobileRequest, mobileData, mobileError, mobileServerError } from "@/lib/mobile/http";
import {
  createTemplate,
  submitForApproval,
  listTemplatesWithStatus,
  isContentApiConfigured,
  type ContentType,
  type TemplateCategory,
} from "@/lib/transport/twilio-content";

export const maxDuration = 60;
const TYPES: ContentType[] = ["text", "media", "quick_reply", "call_to_action"];
const CATEGORIES: TemplateCategory[] = ["MARKETING", "UTILITY", "AUTHENTICATION"];
const NAME_RE = /^[a-z0-9_]{1,512}$/;

export async function GET(request: Request) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;
  if (!isContentApiConfigured()) return mobileData({ templates: [], configured: false });
  try {
    return mobileData({ templates: await listTemplatesWithStatus(), configured: true });
  } catch (e) {
    return mobileServerError(e, "TEMPLATES_FETCH_FAILED", "تعذّر جلب القوالب");
  }
}

export async function POST(request: Request) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim().toLowerCase() : "";
  const contentType = b.contentType as ContentType;
  const category = (b.category as TemplateCategory) ?? "MARKETING";
  const body = typeof b.body === "string" ? b.body.trim() : "";
  if (!NAME_RE.test(name)) return mobileError(400, "BAD_NAME", "الاسم: أحرف إنجليزية صغيرة وأرقام وشرطة سفلية فقط.");
  if (!TYPES.includes(contentType)) return mobileError(400, "BAD_TYPE", "نوع القالب غير معروف.");
  if (!CATEGORIES.includes(category)) return mobileError(400, "BAD_CATEGORY", "التصنيف غير معروف.");
  if (!body) return mobileError(400, "EMPTY_BODY", "نص الرسالة مطلوب.");
  try {
    const created = await createTemplate({
      name, language: typeof b.language === "string" ? b.language : "ar",
      contentType, body,
      variables: (b.variables as Record<string, string>) ?? {},
      mediaUrl: typeof b.mediaUrl === "string" ? b.mediaUrl : undefined,
      quickReplies: Array.isArray(b.quickReplies) ? (b.quickReplies as never) : undefined,
      ctaButtons: Array.isArray(b.ctaButtons) ? (b.ctaButtons as never) : undefined,
    });
    const approval = await submitForApproval(created.sid, name, category);
    return mobileData({ sid: created.sid, name: created.name, status: approval.status });
  } catch (e) {
    return mobileError(400, "TEMPLATE_CREATE_FAILED", e instanceof Error ? e.message : "تعذّر إنشاء القالب");
  }
}
