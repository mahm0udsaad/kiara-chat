/**
 * How many times the tracked conversation labels were put on a chat in a
 * period, and by whom. One assignment row = one time an employee ticked the
 * label in the actions sheet (`assigned_by`, `assigned_at`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import type { LabelColor } from "@/lib/types";

/**
 * The labels the owner follows in the customer-service report. Matched by
 * name, loosely (spaces, ه/ة, أ/إ/آ), so a small rename keeps counting.
 */
export const TRACKED_LABEL_NAMES = [
  "تم التواصل مكالمه",
  "استفسار عن طريق الاتصال",
  "انتظار عربون للتسجيل",
] as const;

export type LabelTallyEmployee = {
  /** team_members.id, or null when the user is not a team member. */
  memberId: string | null;
  name: string;
  count: number;
};

export type LabelTally = {
  id: string;
  name: string;
  color: LabelColor;
  total: number;
  employees: LabelTallyEmployee[];
};

type LabelRow = { id: string; name: string; color: LabelColor };
type AssignmentRow = { label_id: string; assigned_by: string | null; assigned_at: string };
type MemberRow = { id: string; user_id: string | null; full_name: string | null };

export function normalizeLabelName(name: string): string {
  return name
    .replace(/\s+/g, "")
    .replace(/[ـ]/g, "")
    .replace(/ة/g, "ه")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي");
}

const TRACKED = TRACKED_LABEL_NAMES.map(normalizeLabelName);

/** Pure tally, kept apart from the queries so it can be tested. */
export function tallyLabels(
  labels: LabelRow[],
  assignments: AssignmentRow[],
  members: MemberRow[],
): LabelTally[] {
  const tracked = labels
    .filter((label) => TRACKED.includes(normalizeLabelName(label.name)))
    .sort(
      (a, b) =>
        TRACKED.indexOf(normalizeLabelName(a.name)) -
        TRACKED.indexOf(normalizeLabelName(b.name)),
    );
  const memberByUser = new Map(
    members.filter((m) => m.user_id).map((m) => [m.user_id as string, m]),
  );

  return tracked.map((label) => {
    const byActor = new Map<string, LabelTallyEmployee>();
    let total = 0;
    for (const row of assignments) {
      if (row.label_id !== label.id) continue;
      total += 1;
      const member = row.assigned_by ? memberByUser.get(row.assigned_by) : undefined;
      const key = member?.id ?? row.assigned_by ?? "unknown";
      const entry = byActor.get(key) ?? {
        memberId: member?.id ?? null,
        name: member?.full_name?.trim() || "غير معروف",
        count: 0,
      };
      entry.count += 1;
      byActor.set(key, entry);
    }
    return {
      id: label.id,
      name: label.name,
      color: label.color,
      total,
      employees: [...byActor.values()].sort(
        (a, b) =>
          b.count - a.count ||
          Number(a.memberId === null) - Number(b.memberId === null) ||
          a.name.localeCompare(b.name, "ar"),
      ),
    };
  });
}

const PAGE_SIZE = 1000;

export async function getLabelTallies(
  admin: SupabaseClient,
  rangeStart: string,
  rangeEndExclusive: string,
): Promise<LabelTally[]> {
  const labelsResult = await admin
    .from("conversation_labels")
    .select("id, name, color")
    .eq("restaurant_id", KIARA_RESTAURANT_ID);
  if (labelsResult.error) throw new Error(labelsResult.error.message);
  const labels = ((labelsResult.data ?? []) as LabelRow[]).filter((label) =>
    TRACKED.includes(normalizeLabelName(label.name)),
  );
  if (!labels.length) return [];

  const assignments: AssignmentRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const page = await admin
      .from("conversation_label_assignments")
      .select("label_id, assigned_by, assigned_at, conversation_id")
      .in("label_id", labels.map((label) => label.id))
      .gte("assigned_at", rangeStart)
      .lt("assigned_at", rangeEndExclusive)
      .order("assigned_at", { ascending: true })
      .order("conversation_id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (page.error) throw new Error(page.error.message);
    const rows = (page.data ?? []) as AssignmentRow[];
    assignments.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }

  const userIds = [
    ...new Set(assignments.map((row) => row.assigned_by).filter(Boolean) as string[]),
  ];
  let members: MemberRow[] = [];
  if (userIds.length) {
    const result = await admin
      .from("team_members")
      .select("id, user_id, full_name")
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .in("user_id", userIds);
    if (result.error) throw new Error(result.error.message);
    members = (result.data ?? []) as MemberRow[];
  }
  return tallyLabels(labels, assignments, members);
}
