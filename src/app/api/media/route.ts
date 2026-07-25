/**
 * GET /api/media?path=<storagePath>
 * Returns a short-lived signed URL for a whatsapp-media object, but ONLY for
 * paths under Kiara's tenant folder (anti-guessing). Uses the RLS-respecting
 * client, so storage policies are the second line of defense.
 */
import { NextRequest, NextResponse } from "next/server";
import { getKiaraSession, KIARA_RESTAURANT_ID } from "@/lib/tenant";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const BUCKET = "whatsapp-media";
const TTL_SECONDS = 3600;

export async function GET(request: NextRequest) {
  const session = await getKiaraSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const path = request.nextUrl.searchParams.get("path") || "";
  if (!path) {
    return NextResponse.json({ error: "Missing 'path'" }, { status: 400 });
  }
  // The first path segment is the restaurant id — it must be Kiara's.
  if (path.split("/")[0] !== KIARA_RESTAURANT_ID) {
    return NextResponse.json({ error: "Tenant mismatch" }, { status: 403 });
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, TTL_SECONDS);

  if (error || !data?.signedUrl) {
    return NextResponse.json(
      { error: error?.message || "Failed to sign URL" },
      { status: 500 }
    );
  }
  return NextResponse.json({ url: data.signedUrl });
}
