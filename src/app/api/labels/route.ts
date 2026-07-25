import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { listLabels, createLabel } from "@/lib/labels";
import type { LabelColor } from "@/lib/types";

export async function GET() {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ labels: await listLabels() });
}

export async function POST(request: Request) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const name = (body?.name as string | undefined)?.trim();
  const color = (body?.color as LabelColor | undefined) ?? "slate";
  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
  try {
    const label = await createLabel(session.userId, name, color);
    return NextResponse.json({ ok: true, label });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to create label" },
      { status: 500 }
    );
  }
}
