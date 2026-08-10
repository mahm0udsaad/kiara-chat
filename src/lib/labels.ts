/**
 * Labels for Kiara conversations. Uses the shared conversation_labels +
 * conversation_label_assignments tables (already tenant-scoped by RLS). Any
 * agent can create labels. Assignments use full-replace semantics.
 * Runs through the AUTHED client so RLS + created_by/assigned_by = auth.uid().
 */
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import type { Label, LabelColor } from "@/lib/types";

export const LABEL_COLORS: LabelColor[] = [
  "slate",
  "red",
  "amber",
  "emerald",
  "blue",
  "indigo",
  "fuchsia",
  "rose",
];

export async function listLabels(): Promise<Label[]> {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase
    .from("conversation_labels")
    .select("id, name, color")
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .order("name");
  return (data ?? []) as Label[];
}

/** Map of conversationId -> labelId[] for all of Kiara's conversations. */
export async function getLabelAssignments(): Promise<Record<string, string[]>> {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase
    .from("conversation_label_assignments")
    .select("conversation_id, label_id, conversations!inner(restaurant_id)")
    .eq("conversations.restaurant_id", KIARA_RESTAURANT_ID);
  const map: Record<string, string[]> = {};
  for (const row of data ?? []) {
    const cid = row.conversation_id as string;
    (map[cid] ||= []).push(row.label_id as string);
  }
  return map;
}

export async function createLabel(
  userId: string,
  name: string,
  color: LabelColor
): Promise<Label> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("conversation_labels")
    .insert({
      restaurant_id: KIARA_RESTAURANT_ID,
      name: name.trim().slice(0, 40),
      color: LABEL_COLORS.includes(color) ? color : "slate",
      created_by: userId,
    })
    .select("id, name, color")
    .single();
  if (error) throw new Error(error.message);
  return data as Label;
}

/** Full-replace the labels on a conversation. */
export async function setConversationLabels(
  userId: string,
  conversationId: string,
  labelIds: string[]
): Promise<void> {
  const supabase = await createServerSupabaseClient();
  await supabase
    .from("conversation_label_assignments")
    .delete()
    .eq("conversation_id", conversationId);
  if (labelIds.length) {
    const rows = labelIds.map((label_id) => ({
      conversation_id: conversationId,
      label_id,
      assigned_by: userId,
    }));
    const { error } = await supabase
      .from("conversation_label_assignments")
      .insert(rows);
    if (error) throw new Error(error.message);
  }
}
