/**
 * Which delivery states a provider's report is allowed to replace.
 *
 * Reports do not arrive in order. Meta may deliver "delivered" after "read",
 * and a WhatsApp linked device hears a late "sent" for every message once the
 * account's own phone has caught up — long after the recipient read it. Taking
 * each report at face value walked a read message back to one grey tick, so a
 * mark only ever moves forward: queued → sent → delivered → read.
 *
 * A failure can still replace "sent" (the provider accepted the message and
 * then could not deliver it), and proof of arrival replaces a failure, because
 * a message that was read was not lost whatever was recorded first.
 *
 * Any state not listed for `next` is left alone — including an inbound
 * message's own "received", which no receipt about it should overwrite.
 */

const NOT_YET_SENT = ["queued", "pending", "sending", "uncertain"];

/** Null means the report is not one of ours to order: apply it as it comes. */
export function statusesReplaceableBy(next: string): string[] | null {
  switch (next) {
    case "sent":
      return NOT_YET_SENT;
    case "failed":
    case "undelivered":
      return [...NOT_YET_SENT, "sent"];
    case "delivered":
      return [...NOT_YET_SENT, "sent", "failed", "undelivered"];
    case "read":
      return [...NOT_YET_SENT, "sent", "failed", "undelivered", "delivered"];
    default:
      return null;
  }
}
