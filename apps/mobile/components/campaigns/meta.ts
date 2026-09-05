import type { BadgeTone } from "@/components/ui/badge";
import type { IconName } from "@/components/ui/icon-symbol";
import type { CampaignSegment } from "@/types/api";

/** One source of truth for how templates/campaigns look across the screens. */

export const TEMPLATE_TYPE_META: Record<string, { label: string; icon: IconName; hint: string }> = {
  text: { label: "نص", icon: "message", hint: "رسالة نصية فقط" },
  "twilio/text": { label: "نص", icon: "message", hint: "رسالة نصية فقط" },
  media: { label: "صورة/وسائط", icon: "photo", hint: "نص مع صورة أو ملف" },
  "twilio/media": { label: "صورة/وسائط", icon: "photo", hint: "نص مع صورة أو ملف" },
  quick_reply: { label: "أزرار رد سريع", icon: "checkmark.circle", hint: "نص مع أزرار للرد" },
  "twilio/quick-reply": { label: "أزرار رد سريع", icon: "checkmark.circle", hint: "نص مع أزرار للرد" },
  call_to_action: { label: "أزرار إجراء", icon: "phone", hint: "رابط أو اتصال" },
  "twilio/call-to-action": { label: "أزرار إجراء", icon: "phone", hint: "رابط أو اتصال" },
};

export const TEMPLATE_STATUS_META: Record<
  string,
  { label: string; tone: BadgeTone; icon: IconName }
> = {
  approved: { label: "معتمد", tone: "success", icon: "checkmark.circle" },
  received: { label: "قيد المراجعة", tone: "warning", icon: "hourglass" },
  pending: { label: "قيد المراجعة", tone: "warning", icon: "hourglass" },
  rejected: { label: "مرفوض", tone: "danger", icon: "exclamationmark.triangle" },
  unsubmitted: { label: "غير مُرسل", tone: "neutral", icon: "pencil" },
};

export const CAMPAIGN_STATUS_META: Record<
  string,
  { label: string; tone: BadgeTone; icon: IconName }
> = {
  active: { label: "يعمل", tone: "success", icon: "paperplane.fill" },
  paused: { label: "متوقف", tone: "warning", icon: "pause.fill" },
  done: { label: "مكتمل", tone: "neutral", icon: "checkmark.circle" },
};

export const SEGMENT_META: Record<CampaignSegment, { label: string; hint: string; icon: IconName }> = {
  all: { label: "كل العملاء", hint: "القائمة كاملة", icon: "person.2" },
  week: { label: "حجزوا هذا الأسبوع", hint: "آخر حجز خلال ٧ أيام", icon: "calendar" },
  month: { label: "حجزوا هذا الشهر", hint: "آخر حجز خلال ٣٠ يومًا", icon: "calendar" },
  upcoming: { label: "لديهم حجز قادم", hint: "موعد قادم لم يحن بعد", icon: "clock" },
  dormant: { label: "بدون حجز حديث", hint: "لا حجز في الفترة المسجّلة", icon: "moon" },
};

export const TEMPLATE_TYPES: { key: "text" | "media" | "quick_reply" | "call_to_action" }[] = [
  { key: "text" },
  { key: "media" },
  { key: "quick_reply" },
  { key: "call_to_action" },
];
