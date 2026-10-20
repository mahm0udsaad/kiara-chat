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

/**
 * The status text for a chat. Recording any outcome also closes the chat, and
 * a closed chat reads «تم الطلب» — beside «لم ترد العميلة» that claims an
 * order nobody placed. A closed chat with an outcome reads as its outcome.
 */
export function conversationStatusText(
  csStatus: string,
  contactOutcome: unknown,
  statusLabel: string,
): string {
  return csStatus === "resolved" && isContactOutcome(contactOutcome)
    ? CONTACT_OUTCOME_LABEL[contactOutcome]
    : statusLabel;
}

/**
 * Does a chat belong under a status filter? Recording any outcome closes the
 * chat, so «لم يتم الحجز» and «لم ترد العميلة» land in `resolved` — whose
 * filter reads «تم الطلب». A chat that closed without a booking is not an
 * order: it is found under its outcome, never under «تم الطلب».
 */
export function matchesStatusFilter(
  csStatus: string | null | undefined,
  contactOutcome: unknown,
  filter: string,
): boolean {
  if (csStatus !== filter) return false;
  return filter !== "resolved" || (contactOutcome !== "not_booked" && contactOutcome !== "no_reply");
}

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
