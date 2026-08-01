import { NextResponse } from "next/server";
import { getKiaraSession, KIARA_RESTAURANT_ID } from "@/lib/tenant";
import { setConversationRouting } from "@/lib/interactions";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Owner-only: route this chat exclusively to one employee, or clear the route.
 * A routed chat disappears from every other employee's inbox — which is also
 * what stops it from notifying them.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const target = (body?.targetTeamMemberId as string | undefined)?.trim() || null;

  // Routing to someone who isn't on the team would hide the chat from everyone.
  if (target) {
    const supabase = await createServerSupabaseClient();
    const { data: member } = await supabase
      .from("team_members")
      .select("id")
      .eq("id", target)
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .eq("is_active", true)
      .maybeSingle();
    if (!member)
      return NextResponse.json({ error: "الموظف غير موجود" }, { status: 400 });
  }

  try {
    const conversation = await setConversationRouting(id, target);
    return NextResponse.json({ ok: true, conversation });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "تعذّر توجيه المحادثة" },
      { status: 500 }
    );
  }
}
