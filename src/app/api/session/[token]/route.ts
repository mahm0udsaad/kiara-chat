import { NextResponse } from "next/server";
import {
  getFieldSessionDashboard,
  updateFieldSession,
  type FieldSessionAction,
} from "@/lib/field-session";

/** Load the signed specialist/driver dashboard for web or an Expo deep link. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  try {
    const dashboard = await getFieldSessionDashboard(token);
    return NextResponse.json(
      { dashboard },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "تعذّر تحميل الجلسات",
      },
      { status: 400 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const body = await request.json().catch(() => ({}));
  const action = body?.action as FieldSessionAction;
  const orderId = String(body?.orderId ?? "");
  if (action !== "start" && action !== "complete") {
    return NextResponse.json({ error: "الإجراء غير صحيح" }, { status: 400 });
  }
  try {
    const state = await updateFieldSession(token, orderId, action);
    return NextResponse.json({ ok: true, state });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "تعذّر تحديث الجلسة" },
      { status: 400 }
    );
  }
}
