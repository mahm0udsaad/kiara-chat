/**
 * GET /api/media?path=<storagePath>
 * Returns a short-lived signed URL for a whatsapp-media object, but ONLY for
 * paths under Kiara's tenant folder (anti-guessing) and only for a conversation
 * the caller can actually open.
 *
 * The tenant prefix alone was never enough once this signs with the admin
 * client: every employee shares that prefix, so it would have handed a routed
 * chat's photos to a colleague the route itself keeps out of the thread. The
 * conversation check below is what replaces the storage policy that does not
 * exist — see the mobile route for why signing had to move off the RLS client.
 */
import { NextRequest, NextResponse } from "next/server";
import { getKiaraSession, KIARA_RESTAURANT_ID } from "@/lib/tenant";
import { getConversationById } from "@/lib/inbox";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";

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

  // Second segment is the conversation the object belongs to; a caller who
  // cannot open the thread cannot read what was sent inside it.
  const conversationId = path.split("/")[1] || "";
  if (!conversationId) {
    return NextResponse.json({ error: "Invalid media path" }, { status: 400 });
  }
  const conversation = await getConversationById(conversationId, {
    isAdmin: session.role === "admin",
    teamMemberId: session.teamMemberId,
  });
  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const supabase = getAdminSupabaseClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, TTL_SECONDS);

  if (error || !data?.signedUrl) {
    console.error("[media] sign failed", { path, error });
    return NextResponse.json({ error: "Failed to sign URL" }, { status: 500 });
  }
  return NextResponse.json({ url: data.signedUrl });
}
