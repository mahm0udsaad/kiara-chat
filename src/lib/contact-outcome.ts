import type { ContactOutcome, Conversation } from "@/lib/types";

export const CONTACT_OUTCOME_ORDER: ContactOutcome[] = [
  "booked",
  "not_booked",
  "no_reply",
];

export const CONTACT_OUTCOME_LABEL: Record<ContactOutcome, string> = {
  booked: "تم تأكيد الحجز",
  not_booked: "لم يتم الحجز",
  no_reply: "لم ترد العميلة",
};

export function isContactOutcome(value: unknown): value is ContactOutcome {
  return (
    typeof value === "string" &&
    CONTACT_OUTCOME_ORDER.includes(value as ContactOutcome)
  );
}

export function contactOutcomeOf(
  conversation: Pick<Conversation, "metadata">,
): ContactOutcome | null {
  const value = (
    conversation.metadata as { contact_outcome?: unknown } | null
  )?.contact_outcome;
  return isContactOutcome(value) ? value : null;
}
