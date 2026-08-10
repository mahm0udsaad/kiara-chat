/**
 * Owner-only reporting: per-employee conversation load and outcomes.
 *
 * Everything is derived from data the inbox already writes — conversation
 * ownership (conversations.assigned_to), CS status (metadata.cs_status),
 * message attribution (messages.sender_team_member_id) and labels. Nothing
 * here is a separate analytics pipeline, so the numbers can't drift from the
 * inbox.
 *
 * Aggregation happens in JS rather than SQL because a salon's volume is small
 * and it keeps the tenant pin in one obvious place. If this ever gets slow,
 * move the counts into a Postgres view scoped to the tenant.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import type { CsStatus, LabelColor } from "@/lib/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface LabelCount {
  id: string;
  name: string;
  color: LabelColor;
  count: number;
}

export interface AgentReport {
  teamMemberId: string;
  name: string;
  email: string | null;
  role: string;
  isActive: boolean;
  /** Conversations currently assigned to them, by CS status. */
  running: number;
  waiting: number;
  resolved: number;
  totalHandled: number;
  messagesSent: number;
  complaints: number;
  lastReplyAt: string | null;
  labels: LabelCount[];
}

export interface TeamReport {
  agents: AgentReport[];
  totals: {
    conversations: number;
    unassigned: number;
    running: number;
    waiting: number;
    resolved: number;
    handledOnWhatsApp: number;
    messagesSent: number;
    complaints: number;
  };
  labelTotals: LabelCount[];
}

/** Labels that read as a complaint, so the owner gets that as a first-class number. */
const COMPLAINT_PATTERN = /شكو|شكاو|complain/i;

function csStatusOf(metadata: unknown, status: string): CsStatus {
  const meta = (metadata as { cs_status?: CsStatus } | null) ?? {};
  if (meta.cs_status) return meta.cs_status;
  return status === "resolved" ? "resolved" : "open";
}

interface MessageStats {
  total: number;
  byAgent: Map<string, { count: number; lastReplyAt: string | null }>;
}

/**
 * Count message activity in Postgres instead of transferring every message.
 *
 * The Data API caps normal row responses (1,000 in this project), which made
 * the old report both heavy and silently incomplete. Exact HEAD counts are not
 * row-limited, and only one timestamp row is returned per employee.
 */
async function getMessageStats(
  admin: SupabaseClient,
  memberIds: string[]
): Promise<MessageStats> {
  const messageCountQuery = () =>
    admin
      .from("messages")
      .select("conversations!inner(restaurant_id)", {
        count: "exact",
        head: true,
      })
      .eq("conversations.restaurant_id", KIARA_RESTAURANT_ID)
      .eq("role", "agent");

  const [totalResult, agentResults] = await Promise.all([
    messageCountQuery(),
    Promise.all(
      memberIds.map(async (memberId) => {
        const [countResult, latestResult] = await Promise.all([
          messageCountQuery().eq("sender_team_member_id", memberId),
          admin
            .from("messages")
            .select("created_at, conversations!inner(restaurant_id)")
            .eq("conversations.restaurant_id", KIARA_RESTAURANT_ID)
            .eq("role", "agent")
            .eq("sender_team_member_id", memberId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);
        if (countResult.error) throw new Error(countResult.error.message);
        if (latestResult.error) throw new Error(latestResult.error.message);
        return [
          memberId,
          {
            count: countResult.count ?? 0,
            lastReplyAt:
              (latestResult.data?.created_at as string | undefined) ?? null,
          },
        ] as const;
      })
    ),
  ]);
  if (totalResult.error) throw new Error(totalResult.error.message);

  return {
    total: totalResult.count ?? 0,
    byAgent: new Map(agentResults),
  };
}

export async function getTeamReport(): Promise<TeamReport> {
  const admin = getAdminSupabaseClient();

  // Materialize the member query once: message aggregates depend on its ids,
  // while the other report queries continue in parallel.
  const membersPromise = Promise.resolve(
    admin
      .from("team_members")
      .select("id, user_id, role, full_name, is_active")
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .order("created_at")
  );
  const messageStatsPromise = membersPromise.then((result) => {
    if (result.error) throw new Error(result.error.message);
    return getMessageStats(
      admin,
      (result.data ?? []).map((member) => member.id as string)
    );
  });

  const [membersRes, convRes, labelRes, assignRes, messageStats] =
    await Promise.all([
      membersPromise,
      admin
        .from("conversations")
        .select("id, assigned_to, status, metadata")
        .eq("restaurant_id", KIARA_RESTAURANT_ID),
      admin
        .from("conversation_labels")
        .select("id, name, color")
        .eq("restaurant_id", KIARA_RESTAURANT_ID),
      admin
        .from("conversation_label_assignments")
        .select("conversation_id, label_id, conversations!inner(restaurant_id)")
        .eq("conversations.restaurant_id", KIARA_RESTAURANT_ID),
      messageStatsPromise,
    ]);

  const members = membersRes.data ?? [];
  const conversations = convRes.data ?? [];
  const labels = (labelRes.data ?? []) as { id: string; name: string; color: LabelColor }[];
  const assignments = (assignRes.data ?? []) as {
    conversation_id: string;
    label_id: string;
  }[];

  const labelById = new Map(labels.map((l) => [l.id, l]));
  const complaintLabelIds = new Set(
    labels.filter((l) => COMPLAINT_PATTERN.test(l.name)).map((l) => l.id)
  );

  // conversation -> owner, so label assignments can be attributed.
  const ownerOf = new Map<string, string | null>();
  for (const c of conversations) {
    ownerOf.set(c.id as string, (c.assigned_to as string | null) ?? null);
  }

  const perAgentLabels = new Map<string, Map<string, number>>();
  const labelTotalCounts = new Map<string, number>();
  const complaintsByAgent = new Map<string, number>();
  let complaintsTotal = 0;

  for (const a of assignments) {
    labelTotalCounts.set(a.label_id, (labelTotalCounts.get(a.label_id) ?? 0) + 1);
    if (complaintLabelIds.has(a.label_id)) complaintsTotal += 1;

    const owner = ownerOf.get(a.conversation_id);
    if (!owner) continue;
    if (!perAgentLabels.has(owner)) perAgentLabels.set(owner, new Map());
    const m = perAgentLabels.get(owner)!;
    m.set(a.label_id, (m.get(a.label_id) ?? 0) + 1);
    if (complaintLabelIds.has(a.label_id)) {
      complaintsByAgent.set(owner, (complaintsByAgent.get(owner) ?? 0) + 1);
    }
  }

  const totals = {
    conversations: conversations.length,
    unassigned: 0,
    running: 0,
    waiting: 0,
    resolved: 0,
    handledOnWhatsApp: 0,
    messagesSent: messageStats.total,
    complaints: complaintsTotal,
  };

  const byAgent = new Map<string, { running: number; waiting: number; resolved: number }>();
  for (const c of conversations) {
    const cs = csStatusOf(c.metadata, c.status as string);
    if (cs === "open") totals.running += 1;
    else if (cs === "waiting") totals.waiting += 1;
    else totals.resolved += 1;

    if ((c.metadata as { handled_on_whatsapp?: boolean } | null)?.handled_on_whatsapp) {
      totals.handledOnWhatsApp += 1;
    }

    const owner = c.assigned_to as string | null;
    if (!owner) {
      totals.unassigned += 1;
      continue;
    }
    if (!byAgent.has(owner)) byAgent.set(owner, { running: 0, waiting: 0, resolved: 0 });
    const bucket = byAgent.get(owner)!;
    if (cs === "open") bucket.running += 1;
    else if (cs === "waiting") bucket.waiting += 1;
    else bucket.resolved += 1;
  }

  const agents: AgentReport[] = await Promise.all(
    members.map(async (m) => {
      const id = m.id as string;
      let email: string | null = null;
      try {
        const u = await admin.auth.admin.getUserById(m.user_id as string);
        email = u.data.user?.email ?? null;
      } catch {
        /* ignore */
      }
      const bucket = byAgent.get(id) ?? { running: 0, waiting: 0, resolved: 0 };
      const labelMap = perAgentLabels.get(id) ?? new Map<string, number>();
      const agentLabels: LabelCount[] = [...labelMap.entries()]
        .map(([labelId, count]) => {
          const l = labelById.get(labelId);
          return l ? { id: l.id, name: l.name, color: l.color, count } : null;
        })
        .filter(Boolean)
        .sort((a, b) => b!.count - a!.count) as LabelCount[];

      const fullName = ((m.full_name as string) || "").trim();
      return {
        teamMemberId: id,
        name: fullName || email?.split("@")[0] || "موظف",
        email,
        role: m.role as string,
        isActive: Boolean(m.is_active),
        running: bucket.running,
        waiting: bucket.waiting,
        resolved: bucket.resolved,
        totalHandled: bucket.running + bucket.waiting + bucket.resolved,
        messagesSent: messageStats.byAgent.get(id)?.count ?? 0,
        complaints: complaintsByAgent.get(id) ?? 0,
        lastReplyAt: messageStats.byAgent.get(id)?.lastReplyAt ?? null,
        labels: agentLabels,
      };
    })
  );

  agents.sort((a, b) => b.totalHandled - a.totalHandled || b.messagesSent - a.messagesSent);

  const labelTotals: LabelCount[] = [...labelTotalCounts.entries()]
    .map(([labelId, count]) => {
      const l = labelById.get(labelId);
      return l ? { id: l.id, name: l.name, color: l.color, count } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b!.count - a!.count) as LabelCount[];

  return { agents, totals, labelTotals };
}
