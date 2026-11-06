/**
 * The measurable half of the staff analysis: reply speed, customers left
 * waiting, and the per-chat transcripts the model reads.
 *
 * Kept free of imports so it can be tested on its own. Numbers here are
 * computed, never asked of the model, so the owner can trust them.
 */

export type AnalysisMessage = {
  id: string;
  conversation_id: string;
  role: "customer" | "agent" | "system";
  sender_team_member_id: string | null;
  content: string | null;
  message_type: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type Speaker = "customer" | "her" | "colleague" | "bot" | "automated" | "system";

/** Message sources that no person typed. */
const AUTOMATED_SOURCES = new Set(["welcome", "order_customer_reminder", "broadcast", "rekaz"]);

export function speakerOf(row: AnalysisMessage, personId: string): Speaker {
  if (row.role === "customer") return "customer";
  if (row.role === "system") return "system";
  const source = typeof row.metadata?.source === "string" ? row.metadata.source : null;
  if (source === "bot") return "bot";
  if (source && AUTOMATED_SOURCES.has(source)) return "automated";
  if (row.metadata?.broadcast === true) return "automated";
  if (row.sender_team_member_id === personId) return "her";
  return "colleague";
}

/** A customer is "answered" only by a person, not by the bot or a template. */
function isHumanReply(speaker: Speaker) {
  return speaker === "her" || speaker === "colleague";
}

export type WaitingChat = { conversationId: string; waitingSince: string };

export type ReplySpeed = {
  /** Every wait that ended with her reply, in minutes. */
  waits: number[];
  medianMinutes: number | null;
  p90Minutes: number | null;
  /** Waits over SLOW_REPLY_MINUTES. */
  slowReplies: number;
  /** Per conversation: the longest wait she answered. */
  longestByConversation: Map<string, { minutes: number; at: string }>;
  /**
   * Chats where she was the last person to answer, then the customer wrote
   * again and no person replied before the period ended.
   */
  leftWaiting: WaitingChat[];
};

export const SLOW_REPLY_MINUTES = 30;
/** Ignore a fresh customer message too close to the end to fairly expect a reply. */
const LEFT_WAITING_GRACE_MINUTES = 30;

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return Math.round(sorted[index]! * 10) / 10;
}

/**
 * `rows` must be oldest-first. `inShift` says whether a customer message
 * landed inside the working hours being reviewed. A wait that started
 * outside them (a message sent at 3am) is not counted against her.
 */
export function measureReplySpeed(
  rows: AnalysisMessage[],
  personId: string,
  inShift: (iso: string) => boolean,
  periodEndMs: number,
): ReplySpeed {
  const byConversation = new Map<string, AnalysisMessage[]>();
  for (const row of rows) {
    const bucket = byConversation.get(row.conversation_id) ?? [];
    bucket.push(row);
    byConversation.set(row.conversation_id, bucket);
  }

  const waits: number[] = [];
  const longestByConversation = new Map<string, { minutes: number; at: string }>();
  const leftWaiting: WaitingChat[] = [];

  for (const [conversationId, messages] of byConversation) {
    let pendingSince: string | null = null;
    let lastHuman: Speaker | null = null;
    for (const row of messages) {
      const speaker = speakerOf(row, personId);
      if (speaker === "customer") {
        if (!pendingSince && inShift(row.created_at)) pendingSince = row.created_at;
        continue;
      }
      if (!isHumanReply(speaker)) continue;
      if (pendingSince && speaker === "her") {
        const minutes = Math.max(
          0,
          (Date.parse(row.created_at) - Date.parse(pendingSince)) / 60_000,
        );
        if (Number.isFinite(minutes)) {
          waits.push(minutes);
          const longest = longestByConversation.get(conversationId);
          if (!longest || minutes > longest.minutes) {
            longestByConversation.set(conversationId, { minutes, at: pendingSince });
          }
        }
      }
      pendingSince = null;
      lastHuman = speaker;
    }
    if (
      pendingSince &&
      lastHuman === "her" &&
      periodEndMs - Date.parse(pendingSince) >= LEFT_WAITING_GRACE_MINUTES * 60_000
    ) {
      leftWaiting.push({ conversationId, waitingSince: pendingSince });
    }
  }

  const sorted = [...waits].sort((a, b) => a - b);
  return {
    waits,
    medianMinutes: percentile(sorted, 0.5),
    p90Minutes: percentile(sorted, 0.9),
    slowReplies: waits.filter((minutes) => minutes > SLOW_REPLY_MINUTES).length,
    longestByConversation,
    leftWaiting,
  };
}

const SPEAKER_LABEL: Record<Speaker, string> = {
  customer: "العميلة",
  her: "الموظفة",
  colleague: "موظفة أخرى",
  bot: "البوت",
  automated: "رسالة آلية",
  system: "النظام",
};

/**
 * One block per chat, oldest-first, each line stamped with Riyadh time so the
 * model can see delays. `ref` is the short handle («م3») the model cites back.
 */
export function formatConversation(
  ref: string,
  title: string,
  messages: AnalysisMessage[],
  personId: string,
  formatTime: (iso: string) => string,
  maxChars: number,
) {
  const lines = messages
    .filter((row) => row.role !== "system")
    .map((row) => {
      const speaker = SPEAKER_LABEL[speakerOf(row, personId)];
      const body =
        row.content?.replace(/\s+/g, " ").trim().slice(0, maxChars) ||
        `[${row.message_type && row.message_type !== "text" ? row.message_type : "رسالة فارغة"}]`;
      return `[${formatTime(row.created_at)} · ${speaker}] ${body}`;
    });
  return [`### ${ref} — ${title}`, ...lines].join("\n");
}

function normalizeForMatch(value: string) {
  return value
    .replace(/[ً-ْـ]/g, "") // harakat and tatweel
    .replace(/[«»"“”'.,،!?؟:؛\s]+/g, " ")
    .trim();
}

/**
 * Keep a quote only if she actually wrote it in that chat. The model is told
 * to quote verbatim; this makes sure a paraphrase never reaches the owner
 * dressed as her words.
 */
export function verifyQuote(
  quote: string | null | undefined,
  messages: AnalysisMessage[],
  personId: string,
  speakers: Speaker[] = ["her"],
): string | null {
  const wanted = normalizeForMatch(quote ?? "");
  if (wanted.length < 3) return null;
  const found = messages.some(
    (row) =>
      speakers.includes(speakerOf(row, personId)) &&
      normalizeForMatch(row.content ?? "").includes(wanted),
  );
  return found ? (quote ?? "").trim() : null;
}

// ---------------------------------------------------------------------------
// What came of her chats: bookings, and customers who keep coming back.

export type SheetOutcome = "booked" | "not_booked" | "no_reply" | null;

export type HandledChat = {
  conversationId: string;
  customerName: string | null;
  /** National digits, as normalizePhone returns them. */
  phone: string;
  /** Her first reply in this chat inside the reviewed period. */
  firstReplyInPeriodMs: number;
  /** Her first reply in this chat ever. */
  firstReplyEverMs: number;
  /** Distinct Riyadh days she replied in this chat, over its whole history. */
  handledDays: number;
  /** «نتيجة التواصل» as the team set it in the actions sheet. */
  sheetOutcome: SheetOutcome;
};

export type BookingRecord = {
  phone: string;
  bookedAtMs: number;
  /** One Rekaz order is one booking, however many services it holds. */
  orderKey: string;
  live: boolean;
  bookedBy: "her" | "colleague" | "online";
};

export type BookingOutcomes = {
  conversion: {
    handled: number;
    booked: number;
    bookedByHer: number;
    bookedByColleague: number;
    bookedOnline: number;
    /** Booked in the window, but every booking was later cancelled. */
    cancelled: number;
    notBooked: number;
    notBookedMarked: { notBooked: number; noReply: number; unmarked: number };
    /** booked / handled, 0–100. */
    rate: number | null;
    /** Chats that did not turn into a booking, for the owner to open. */
    notBookedChats: { conversationId: string; customerName: string | null; sheetOutcome: SheetOutcome }[];
    graceDays: number;
  };
  retention: {
    /** Customers whose chat she handled on two or more separate days. */
    repeatHandled: number;
    /** Of those, the ones who booked two or more times since she first replied. */
    repeatBookers: number;
    /** repeatBookers / repeatHandled, 0–100. */
    rate: number | null;
    customers: {
      conversationId: string;
      customerName: string | null;
      handledDays: number;
      bookings: number;
      lastBookedAt: string | null;
    }[];
  };
  /** Per chat: did it book in the window. Lets the transcript carry the outcome. */
  bookedByConversation: Map<string, "booked" | "cancelled" | "not_booked">;
};

export const BOOKING_GRACE_DAYS = 7;
const LIST_LIMIT = 15;

export function measureBookingOutcomes(
  chats: HandledChat[],
  bookings: BookingRecord[],
  periodEndMs: number,
  nowMs: number,
): BookingOutcomes {
  const byPhone = new Map<string, BookingRecord[]>();
  for (const booking of bookings) {
    if (!booking.phone || !Number.isFinite(booking.bookedAtMs)) continue;
    const bucket = byPhone.get(booking.phone) ?? [];
    bucket.push(booking);
    byPhone.set(booking.phone, bucket);
  }
  const windowEnd = Math.min(nowMs, periodEndMs + BOOKING_GRACE_DAYS * 86_400_000);

  const conversion: BookingOutcomes["conversion"] = {
    handled: chats.length,
    booked: 0,
    bookedByHer: 0,
    bookedByColleague: 0,
    bookedOnline: 0,
    cancelled: 0,
    notBooked: 0,
    notBookedMarked: { notBooked: 0, noReply: 0, unmarked: 0 },
    rate: null,
    notBookedChats: [],
    graceDays: BOOKING_GRACE_DAYS,
  };
  const bookedByConversation = new Map<string, "booked" | "cancelled" | "not_booked">();
  const retained: BookingOutcomes["retention"]["customers"] = [];
  let repeatHandled = 0;
  const seenPhones = new Set<string>();

  for (const chat of chats) {
    const own = byPhone.get(chat.phone) ?? [];
    const inWindow = own.filter(
      (booking) => booking.bookedAtMs >= chat.firstReplyInPeriodMs && booking.bookedAtMs <= windowEnd,
    );
    const live = inWindow.filter((booking) => booking.live);
    if (live.length) {
      conversion.booked += 1;
      bookedByConversation.set(chat.conversationId, "booked");
      // The earliest live booking says who closed it.
      const first = [...live].sort((a, b) => a.bookedAtMs - b.bookedAtMs)[0]!;
      if (first.bookedBy === "her") conversion.bookedByHer += 1;
      else if (first.bookedBy === "colleague") conversion.bookedByColleague += 1;
      else conversion.bookedOnline += 1;
    } else {
      conversion.notBooked += 1;
      if (inWindow.length) {
        conversion.cancelled += 1;
        bookedByConversation.set(chat.conversationId, "cancelled");
      } else {
        bookedByConversation.set(chat.conversationId, "not_booked");
      }
      if (chat.sheetOutcome === "not_booked") conversion.notBookedMarked.notBooked += 1;
      else if (chat.sheetOutcome === "no_reply") conversion.notBookedMarked.noReply += 1;
      else conversion.notBookedMarked.unmarked += 1;
      if (conversion.notBookedChats.length < LIST_LIMIT) {
        conversion.notBookedChats.push({
          conversationId: chat.conversationId,
          customerName: chat.customerName,
          sheetOutcome: chat.sheetOutcome,
        });
      }
    }

    // A customer counts once, however many threads she has.
    if (chat.handledDays < 2 || !chat.phone || seenPhones.has(chat.phone)) continue;
    seenPhones.add(chat.phone);
    repeatHandled += 1;
    const orders = new Map<string, number>();
    for (const booking of own) {
      if (!booking.live || booking.bookedAtMs < chat.firstReplyEverMs) continue;
      orders.set(booking.orderKey, Math.max(orders.get(booking.orderKey) ?? 0, booking.bookedAtMs));
    }
    if (orders.size >= 2) {
      retained.push({
        conversationId: chat.conversationId,
        customerName: chat.customerName,
        handledDays: chat.handledDays,
        bookings: orders.size,
        lastBookedAt: new Date(Math.max(...orders.values())).toISOString(),
      });
    }
  }

  conversion.rate = conversion.handled ? Math.round((conversion.booked / conversion.handled) * 100) : null;
  retained.sort((a, b) => b.bookings - a.bookings);
  return {
    conversion,
    retention: {
      repeatHandled,
      repeatBookers: retained.length,
      rate: repeatHandled ? Math.round((retained.length / repeatHandled) * 100) : null,
      customers: retained.slice(0, LIST_LIMIT),
    },
    bookedByConversation,
  };
}
