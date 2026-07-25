import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { getEngineState } from "@/lib/transport/openwa";

export async function GET() {
  const session = await getKiaraSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json(await getEngineState());
}
