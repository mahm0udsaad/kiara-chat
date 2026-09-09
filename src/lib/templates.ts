/**
 * Approved WhatsApp content templates.
 *
 * Outside the 24-hour service window Meta delivers nothing but these, so each
 * one is a capability the team either has or does not have — and reaching a
 * customer who has never written to us is only possible through one.
 *
 * A template is referenced by `contentSid`, an identifier Twilio mints against
 * a body Meta has approved. The body is duplicated here for two honest
 * reasons: the composer has to show the employee what she is about to send,
 * and the thread has to record what the customer actually received. If the two
 * ever diverge, Meta's copy is the one that goes out.
 */

import {
  isContentApiConfigured,
  listTemplatesWithStatus,
  type TemplateSummary,
} from "@/lib/transport/twilio-content";

export type TemplateKey = "booking_followup" | "conversation_opener" | "number_notice";

export interface TemplateVariableSpec {
  /** Positional key as Twilio wants it: "1", "2", … */
  key: string;
  /** What the employee is being asked for. */
  label: string;
  /** Filled in for her when the conversation already knows the answer. */
  prefill?: "customer_name";
  maxLength?: number;
}

export interface TemplateSpec {
  env: string;
  /** What the employee picks from the list. */
  label: string;
  description: string;
  category: "utility" | "marketing";
  /** Approved body, `{{n}}` placeholders intact. */
  body: string;
  /** Quick-reply button captions, in order. */
  buttons: string[];
  variables: TemplateVariableSpec[];
}

export interface SendableTemplate {
  key: string;
  contentSid: string;
  label: string;
  description: string;
  category: "utility" | "marketing";
  body: string;
  buttons: string[];
  variables: TemplateVariableSpec[];
}

const LIVE_TEMPLATE_PREFIX = "twilio:";

const TEMPLATES: Record<TemplateKey, TemplateSpec> = {
  booking_followup: {
    env: "TWILIO_CONTENT_SID_BOOKING_FOLLOWUP",
    label: "متابعة حجز",
    description:
      "لبدء محادثة مع عميلة لم تراسلنا خلال ٢٤ ساعة. الأزرار تفتح المحادثة فور ضغطها.",
    category: "utility",
    body: "مرحبًا {{1}} 🌸 معكِ فريق كيّارا سبا. نودّ متابعة حجزكِ وتحديد الموعد المناسب لكِ.",
    buttons: ["تأكيد الحجز", "تغيير الموعد"],
    variables: [
      { key: "1", label: "اسم العميلة", prefill: "customer_name", maxLength: 60 },
    ],
  },
  conversation_opener: {
    env: "TWILIO_CONTENT_SID_CONVERSATION_OPENER",
    label: "بدء محادثة",
    description:
      "الافتتاحية العامة: شعار كيّارا ثم تحية باسم العميلة. لأي عميلة خارج نافذة الـ٢٤ ساعة بدون سبب محدد.",
    category: "marketing",
    body: "السلام عليكم {{1}} 🌸\nمعكِ خدمة عملاء كيارا سبا 🍃",
    buttons: ["أرغب بالاستفسار"],
    variables: [
      { key: "1", label: "اسم العميلة", prefill: "customer_name", maxLength: 60 },
    ],
  },
  number_notice: {
    env: "TWILIO_CONTENT_SID_NUMBER_NOTICE",
    label: "تنويه الرقم",
    description:
      "تنبيه جماعي يطلب من العميلة حذف الرقم وإعادة حفظه ليظهر حساب واتساب الأعمال بشكل صحيح.",
    category: "marketing",
    body:
      "📢 تنويه مهم لعملائنا الكرام 🤍\n\nفي حال كان رقم الواتساب الخاص بكيارا لا يظهر لديكم أو لا يعمل بشكل صحيح، نرجو منكم حذف الرقم من جهات الاتصال في جوالكم ثم إعادة حفظه من جديد.\n\n📱 رقم كيارا سبا:\n966508421748\n\nبعد إعادة حفظ الرقم، افتحوا الواتساب من جديد وسيظهر لكم الحساب بإذن الله 🤍\n\nشاكرين لكم تفهّمكم وصبركم، ونسعد دائمًا بخدمتكم 🌿\nKiara Spa | كيارا سبا",
    buttons: [],
    variables: [],
  },
};

export function templateSpec(key: TemplateKey): TemplateSpec {
  return TEMPLATES[key];
}

export function contentSidFor(key: TemplateKey): string | null {
  return process.env[TEMPLATES[key].env]?.trim() || null;
}

export function isTemplateConfigured(key: TemplateKey): boolean {
  return Boolean(contentSidFor(key));
}

export function isTemplateKey(value: string): value is TemplateKey {
  return Object.prototype.hasOwnProperty.call(TEMPLATES, value);
}

/** What the composer lists. Only templates that can actually be sent appear. */
export function listSendableTemplates(): (TemplateSpec & { key: TemplateKey })[] {
  return (Object.keys(TEMPLATES) as TemplateKey[])
    .filter((key) => isTemplateConfigured(key))
    .map((key) => ({ key, ...TEMPLATES[key] }));
}

function staticSendableTemplates(): SendableTemplate[] {
  return listSendableTemplates().map((template) => ({
    key: template.key,
    contentSid: contentSidFor(template.key)!,
    label: template.label,
    description: template.description,
    category: template.category,
    body: template.body,
    buttons: template.buttons,
    variables: template.variables,
  }));
}

function variableSpecs(keys: string[]): TemplateVariableSpec[] {
  return keys
    .map((key) => ({ key, label: `القيمة ${key}`, maxLength: 512 }));
}

function liveSendableTemplate(template: TemplateSummary): SendableTemplate {
  return {
    key: `${LIVE_TEMPLATE_PREFIX}${template.sid}`,
    contentSid: template.sid,
    label: template.name,
    description:
      template.category === "UTILITY"
        ? "قالب خدمة معتمد من واتساب."
        : template.category === "MARKETING"
          ? "قالب تسويقي معتمد من واتساب."
          : template.category === "AUTHENTICATION"
            ? "قالب مصادقة معتمد من واتساب."
            : "قالب معتمد من واتساب.",
    category: template.category === "MARKETING" ? "marketing" : "utility",
    body: template.body,
    buttons: template.buttons,
    variables: variableSpecs(template.variableKeys),
  };
}

/**
 * What the conversation composer lists: the long-standing configured
 * templates plus every template whose current Meta status is approved.
 * Configured templates win by content SID so the employee never sees the same
 * template twice with two different labels.
 */
export async function listComposerTemplates(): Promise<SendableTemplate[]> {
  const configured = staticSendableTemplates();
  if (!isContentApiConfigured()) return configured;

  const configuredSids = new Set(configured.map((template) => template.contentSid));
  const live = (await listTemplatesWithStatus())
    .filter(
      (template) =>
        template.status === "approved" &&
        template.body.trim().length > 0 &&
        !configuredSids.has(template.sid),
    )
    .map(liveSendableTemplate);

  return [...configured, ...live];
}

/** Resolve from the server-side source of truth; never trust a client SID. */
export async function resolveComposerTemplate(key: string): Promise<SendableTemplate> {
  if (isTemplateKey(key)) {
    const contentSid = contentSidFor(key);
    if (!contentSid) throw new Error("هذا القالب غير مُهيّأ بعد. راجعي إعدادات النشر.");
    const template = templateSpec(key);
    return {
      key,
      contentSid,
      label: template.label,
      description: template.description,
      category: template.category,
      body: template.body,
      buttons: template.buttons,
      variables: template.variables,
    };
  }

  if (!key.startsWith(LIVE_TEMPLATE_PREFIX)) throw new Error("قالب غير معروف");
  const contentSid = key.slice(LIVE_TEMPLATE_PREFIX.length);
  if (!/^HX[a-zA-Z0-9]{32}$/.test(contentSid)) throw new Error("قالب غير معروف");
  if (!isContentApiConfigured()) throw new Error("تعذّر التحقق من اعتماد القالب.");

  const template = (await listTemplatesWithStatus()).find(
    (candidate) => candidate.sid === contentSid,
  );
  if (!template || template.status !== "approved" || !template.body.trim()) {
    throw new Error("هذا القالب غير معتمد حاليًا في واتساب.");
  }
  return liveSendableTemplate(template);
}

/**
 * Make a value safe to pass as a template variable.
 *
 * Newlines are the trap: staff-typed text routinely contains them and Meta
 * rejects the send rather than the template, so the failure surfaces far from
 * its cause. Collapsing them is lossy but visible, which beats a send that
 * silently never happens.
 */
export function templateVariable(value: string, maxLength = 512): string {
  const flattened = value
    .replace(/[\r\n\t]+/g, " • ")
    .replace(/ {4,}/g, "   ")
    .trim();
  return flattened.length > maxLength
    ? `${flattened.slice(0, maxLength - 1)}…`
    : flattened;
}

/** The customer's name, or a neutral address when we don't have one. */
export function greetingName(customerName: string | null | undefined): string {
  const name = (customerName ?? "").trim();
  return name ? templateVariable(name, 60) : "عميلتنا العزيزة";
}

/**
 * The body as the customer will read it — used for the preview before sending
 * and stored as the message's text afterwards, so the thread is not a row of
 * blank bubbles saying only that "a template" went out.
 */
export function renderTemplate(
  key: TemplateKey,
  variables: Record<string, string>,
): string {
  return templateSpec(key).body.replace(/\{\{(\d+)\}\}/g, (whole, index) => {
    const value = variables[index];
    return value && value.trim() ? value : whole;
  });
}

export function renderTemplateBody(
  body: string,
  variables: Record<string, string>,
): string {
  return body.replace(/\{\{(\d+)\}\}/g, (whole, index) => {
    const value = variables[index];
    return value && value.trim() ? value : whole;
  });
}
