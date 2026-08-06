import type { BookingStage, Conversation } from "@/lib/types";

export const BOOKING_STAGE_ORDER: BookingStage[] = [
  "collecting_details",
  "awaiting_confirmation",
  "booking_confirmed",
  "invoice_required",
  "in_progress",
  "completed",
];

export const BOOKING_STAGE_LABEL: Record<BookingStage, string> = {
  collecting_details: "استلام بيانات",
  awaiting_confirmation: "انتظار تأكيد الحجز",
  booking_confirmed: "تم تأكيد الحجز",
  invoice_required: "إرفاق الفاتورة",
  in_progress: "قيد التنفيذ",
  completed: "تم التنفيذ",
};

export function isBookingStage(value: unknown): value is BookingStage {
  return (
    typeof value === "string" &&
    BOOKING_STAGE_ORDER.includes(value as BookingStage)
  );
}

export function bookingStageOf(
  conversation: Pick<Conversation, "metadata">
): BookingStage | null {
  const value = (conversation.metadata as { booking_stage?: unknown } | null)
    ?.booking_stage;
  return isBookingStage(value) ? value : null;
}
