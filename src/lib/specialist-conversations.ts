import "server-only";

import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import type { Label } from "@/lib/types";

const ARABIC_MARKS = /[\u0610-\u061a\u0640\u064b-\u065f\u0670\u06d6-\u06ed]/g;

/**
 * Stable comparison for the roster classification label shown as اخصائية.
 *
 * Staff may spell it with a leading hamza, a final ه, or the definite article;
 * those typography differences should not move the same person between inboxes.
 */
export function isSpecialistLabelName(name: string): boolean {
  const normalized = name
    .normalize("NFKC")
    .trim()
    .replace(ARABIC_MARKS, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/\s+/g, "")
    .replace(/^ال(?=اخصائي)/, "");
  return normalized === "اخصائية" || normalized === "اخصائيه";
}

/** Resolve specialist-labelled threads from already-loaded inbox label data. */
export function specialistConversationIdsFromLabels(
  labels: Pick<Label, "id" | "name">[],
  assignments: Record<string, string[]>,
): ReadonlySet<string> {
  const specialistLabelIds = new Set(
    labels
      .filter((label) => isSpecialistLabelName(label.name))
      .map((label) => label.id),
  );
  if (!specialistLabelIds.size) return new Set();

  return new Set(
    Object.entries(assignments)
      .filter(([, labelIds]) =>
        labelIds.some((labelId) => specialistLabelIds.has(labelId)),
      )
      .map(([conversationId]) => conversationId),
  );
}

/**
 * Service-role equivalent for the scheduled danger sweep, which has no user
 * session and therefore cannot use the RLS-scoped inbox label helpers.
 */
export async function listSpecialistLabeledConversationIds(
  conversationIds: string[],
): Promise<ReadonlySet<string>> {
  if (!conversationIds.length) return new Set();

  const admin = getAdminSupabaseClient();
  const { data: labels, error: labelsError } = await admin
    .from("conversation_labels")
    .select("id, name")
    .eq("restaurant_id", KIARA_RESTAURANT_ID);
  if (labelsError) throw new Error(labelsError.message);

  const specialistLabelIds = (labels ?? [])
    .filter((label) => isSpecialistLabelName(String(label.name ?? "")))
    .map((label) => String(label.id));
  if (!specialistLabelIds.length) return new Set();

  const candidateConversationIds = new Set(conversationIds);
  const { data: assignments, error: assignmentsError } = await admin
    .from("conversation_label_assignments")
    .select("conversation_id")
    .in("label_id", specialistLabelIds);
  if (assignmentsError) throw new Error(assignmentsError.message);

  return new Set(
    (assignments ?? [])
      .map((assignment) => String(assignment.conversation_id))
      .filter((conversationId) => candidateConversationIds.has(conversationId)),
  );
}
