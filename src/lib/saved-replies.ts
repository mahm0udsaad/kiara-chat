/**
 * Saved (canned) replies per tenant. RLS-scoped via the authed client.
 */
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";

export interface SavedReply {
  id: string;
  title: string;
  body: string;
}

export async function listSavedReplies(): Promise<SavedReply[]> {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase
    .from("saved_replies")
    .select("id, title, body")
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .order("title");
  return (data ?? []) as SavedReply[];
}

export async function createSavedReply(
  userId: string,
  title: string,
  body: string
): Promise<SavedReply> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("saved_replies")
    .insert({
      restaurant_id: KIARA_RESTAURANT_ID,
      title: title.trim(),
      body: body.trim(),
      created_by: userId,
    })
    .select("id, title, body")
    .single();
  if (error) throw new Error(error.message);
  return data as SavedReply;
}
