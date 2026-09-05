/**
 * Template management for campaigns (استهدافات).
 *
 * GET  → every template with its live WhatsApp approval status (from Twilio's
 *        ContentAndApprovals, so status is always what Meta actually decided).
 * POST → create a template of one of the four marketing types and submit it for
 *        approval in one step.
 *
 * All staff, by product decision — campaigns are a team tool here.
 */
import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
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

export async function GET() {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isContentApiConfigured()) {
    return NextResponse.json({ templates: [], configured: false });
  }
  try {
    return NextResponse.json({ templates: await listTemplatesWithStatus(), configured: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "تعذّر جلب القوالب" },
      { status: 502 },
    );
  }
}

export async function POST(request: Request) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim().toLowerCase() : "";
  const contentType = b.contentType as ContentType;
  const category = (b.category as TemplateCategory) ?? "MARKETING";
  const body = typeof b.body === "string" ? b.body.trim() : "";
  const language = typeof b.language === "string" ? b.language : "ar";

  if (!NAME_RE.test(name)) {
    return NextResponse.json(
      { error: "الاسم يقبل الأحرف الإنجليزية الصغيرة والأرقام والشرطة السفلية فقط." },
      { status: 400 },
    );
  }
  if (!TYPES.includes(contentType)) {
    return NextResponse.json({ error: "نوع القالب غير معروف." }, { status: 400 });
  }
  if (!CATEGORIES.includes(category)) {
    return NextResponse.json({ error: "التصنيف غير معروف." }, { status: 400 });
  }
  if (!body) {
    return NextResponse.json({ error: "نص الرسالة مطلوب." }, { status: 400 });
  }

  try {
    const created = await createTemplate({
      name,
      language,
      contentType,
      body,
      variables: (b.variables as Record<string, string>) ?? {},
      mediaUrl: typeof b.mediaUrl === "string" ? b.mediaUrl : undefined,
      quickReplies: Array.isArray(b.quickReplies) ? (b.quickReplies as never) : undefined,
      ctaButtons: Array.isArray(b.ctaButtons) ? (b.ctaButtons as never) : undefined,
    });
    const approval = await submitForApproval(created.sid, name, category);
    return NextResponse.json({ sid: created.sid, name: created.name, status: approval.status });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "تعذّر إنشاء القالب" },
      { status: 400 },
    );
  }
}
