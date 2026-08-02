import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { denyIfRouted } from "@/lib/conversation-access";
import { setCustomerName } from "@/lib/interactions";

/** A name, not an essay — the inbox truncates anything longer anyway. */
const MAX_NAME = 80;

/**
 * POST /api/conversations/[id]/name — name the customer from the thread.
 *
 * Most chats arrive with whatever WhatsApp display name the sender happens to
 * have (often nothing, sometimes a nickname), and staff know who these people
 * actually are. An empty string clears it back to the phone number.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const denied = await denyIfRouted(id, session);
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  if (typeof body?.name !== "string") {
    return NextResponse.json({ error: "الاسم مطلوب" }, { status: 400 });
  }
  const name = body.name.trim().slice(0, MAX_NAME);

  try {
    await setCustomerName(id, name || null);
    return NextResponse.json({ ok: true, name: name || null });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "تعذّر حفظ الاسم" },
      { status: 500 }
    );
  }
}
