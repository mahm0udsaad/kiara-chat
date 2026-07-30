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

export async function updateSavedReply(
  id: string,
  patch: { title?: string; body?: string }
): Promise<SavedReply> {
  const supabase = await createServerSupabaseClient();
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) update.title = patch.title.trim();
  if (patch.body !== undefined) update.body = patch.body.trim();
  const { data, error } = await supabase
    .from("saved_replies")
    .update(update)
    .eq("id", id)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .select("id, title, body")
    .single();
  if (error) throw new Error(error.message);
  return data as SavedReply;
}

export async function deleteSavedReply(id: string): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("saved_replies")
    .delete()
    .eq("id", id)
    .eq("restaurant_id", KIARA_RESTAURANT_ID);
  if (error) throw new Error(error.message);
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
