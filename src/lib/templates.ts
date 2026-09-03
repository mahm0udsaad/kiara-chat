/**
 * Approved WhatsApp content templates.
 *
 * Outside the 24-hour service window Meta delivers nothing but these, so each
 * one is a capability the team either has or does not have. They are referenced
 * by `contentSid` — an identifier minted by Twilio and tied to a specific
 * approved body, which is why the text lives in Meta's records rather than here
 * and this file only maps a purpose onto a sid.
 *
 * Variables are positional and keyed "1", "2", … They cannot contain newlines,
 * tabs, or runs of five or more spaces; `templateVariable` enforces that,
 * because a value that breaks the rule is rejected at send time rather than
 * when it is written.
 */

export type TemplateKey = "booking_followup";

interface TemplateSpec {
  /** Env var holding the Twilio content sid. */
  env: string;
  /** What it says, for anyone reading this file rather than Twilio's console. */
  description: string;
}

const TEMPLATES: Record<TemplateKey, TemplateSpec> = {
  booking_followup: {
    env: "TWILIO_CONTENT_SID_BOOKING_FOLLOWUP",
    description:
      "Utility. « مرحبًا {{1}} 🌸 معكِ فريق كيّارا سبا. نودّ متابعة حجزكِ وتحديد الموعد المناسب لكِ. » " +
      "with quick-reply buttons تأكيد الحجز / تغيير الموعد. Reopens the service " +
      "window: a button tap is an inbound message.",
  },
};

export function contentSidFor(key: TemplateKey): string | null {
  return process.env[TEMPLATES[key].env]?.trim() || null;
}

export function isTemplateConfigured(key: TemplateKey): boolean {
  return Boolean(contentSidFor(key));
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
