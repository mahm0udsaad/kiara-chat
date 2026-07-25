/**
 * Internal notes — staff-only, never sent to the customer. Distinct from
 * messages. RLS-scoped via the authed client.
 */
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";

export interface InternalNote {
  id: string;
  body: string;
  author_user_id: string | null;
  created_at: string;
}

export async function listNotes(conversationId: string): Promise<InternalNote[]> {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase
    .from("conversation_internal_notes")
    .select("id, body, author_user_id, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  return (data ?? []) as InternalNote[];
}

export async function addNote(
  userId: string,
  conversationId: string,
  body: string
): Promise<InternalNote> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("conversation_internal_notes")
    .insert({
      conversation_id: conversationId,
      restaurant_id: KIARA_RESTAURANT_ID,
      author_user_id: userId,
      body: body.trim(),
    })
    .select("id, body, author_user_id, created_at")
    .single();
  if (error) throw new Error(error.message);
  return data as InternalNote;
}
