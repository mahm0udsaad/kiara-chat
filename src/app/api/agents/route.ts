import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { listAgents } from "@/lib/interactions";

export async function GET() {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const agents = await listAgents();
  return NextResponse.json({ agents });
}
