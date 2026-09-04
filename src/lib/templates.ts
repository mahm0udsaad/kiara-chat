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

export type TemplateKey = "booking_followup" | "conversation_opener";

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
