import { NextResponse } from "next/server";
import {
  CONVERSATION_EVENTS,
  recordConversationEvents,
} from "@/lib/audit";
import { releaseAssignedConversations } from "@/lib/interactions";
import { getKiaraSession } from "@/lib/tenant";

type ReleaseScope =
  | { scope: "mine" }
  | { scope: "member"; teamMemberId: string }
  | { scope: "all" };

function releaseTarget(
  body: ReleaseScope,
  session: NonNullable<Awaited<ReturnType<typeof getKiaraSession>>>,
): { target: string | null; error?: NextResponse } {
  if (body.scope === "mine") {
    if (!session.teamMemberId) {
      return {
        target: null,
        error: NextResponse.json(
          { error: "الحساب غير مرتبط بعضوية فريق" },
          { status: 400 },
        ),
      };
    }
    return { target: session.teamMemberId };
  }

  if (session.role !== "admin") {
    return {
      target: null,
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  if (body.scope === "all") return { target: null };
  if (body.scope === "member" && typeof body.teamMemberId === "string") {
    return { target: body.teamMemberId };
  }
  return {
    target: null,
    error: NextResponse.json({ error: "طلب غير صالح" }, { status: 400 }),
  };
}

export async function POST(request: Request) {
  const session = await getKiaraSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as ReleaseScope | null;
  if (!body || !["mine", "member", "all"].includes(body.scope)) {
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 });
  }

  const { target, error } = releaseTarget(body, session);
  if (error) return error;

  try {
    const released = await releaseAssignedConversations(target);
    await recordConversationEvents(
      released.map((conversation) => ({
        id: conversation.id,
        payload: {
          previousAssignee: conversation.previousAssignee,
          bulkRelease: true,
        },
      })),
      CONVERSATION_EVENTS.released,
      {
        userId: session.userId,
        teamMemberId: session.teamMemberId,
        role: session.role,
      },
    );
    return NextResponse.json({
      ok: true,
      count: released.length,
      conversationIds: released.map((conversation) => conversation.id),
    });
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "تعذّر إطلاق المحادثات" },
      { status: 500 },
    );
  }
}
