import { getKiaraSession } from "@/lib/tenant";
import { listAgents } from "@/lib/interactions";
import { getConversationById, listConversations } from "@/lib/inbox";
import { listLabels, getLabelAssignments } from "@/lib/labels";
import { listSavedReplies } from "@/lib/saved-replies";
import { InboxClient } from "@/components/inbox/inbox-client";

export const dynamic = "force-dynamic";

/**
 * `?c=<id>` opens straight onto a thread — what the المحادثة column on /orders
 * links to.
 */
export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const { c: requestedId } = await searchParams;
  const session = await getKiaraSession();
  // Exclusively-routed chats are filtered out for everyone but their owner and
  // the admins — that filter is what keeps them out of the list *and* silent.
  const viewer = {
    isAdmin: session?.role === "admin",
    teamMemberId: session?.teamMemberId ?? null,
  };
  const [conversations, agents, labels, labelAssignments, savedReplies] =
    await Promise.all([
      listConversations(200, viewer),
      listAgents(),
      listLabels(),
      getLabelAssignments(),
      listSavedReplies(),
    ]);
  const myTeamMemberId = session?.teamMemberId ?? null;

  // A customer who booked but hasn't messaged lately falls off the end of the
  // 200 most recent, so a deep link has to carry its own thread in.
  const requested =
    requestedId && !conversations.some((c) => c.id === requestedId)
      ? await getConversationById(requestedId, viewer)
      : null;

  return (
    <InboxClient
      conversations={requested ? [requested, ...conversations] : conversations}
      initialConversationId={requestedId ?? null}
      agents={agents}
      myTeamMemberId={myTeamMemberId}
      myEmail={session?.email ?? null}
      isAdmin={session?.role === "admin"}
      labels={labels}
      labelAssignments={labelAssignments}
      savedReplies={savedReplies}
    />
  );
}
