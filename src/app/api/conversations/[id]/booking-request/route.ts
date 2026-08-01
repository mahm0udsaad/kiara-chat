import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { denyIfRouted } from "@/lib/conversation-access";
import { clearBookingRequest } from "@/lib/dispatch";

/**
 * Dismiss the bot-collected booking request on a conversation without creating
 * an order (customer changed her mind, duplicate, staff handled it by phone…).
 * Creating the order clears it automatically — this is the other exit.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const denied = await denyIfRouted(id, session);
  if (denied) return denied;
  try {
    await clearBookingRequest(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "تعذّر الإخفاء" },
      { status: 500 }
    );
  }
}
