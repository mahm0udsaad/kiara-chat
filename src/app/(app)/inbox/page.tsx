import { getKiaraSession } from "@/lib/tenant";
import { listAgents } from "@/lib/interactions";
import { listConversations } from "@/lib/inbox";
import { listLabels, getLabelAssignments } from "@/lib/labels";
import { listSavedReplies } from "@/lib/saved-replies";
import { InboxClient } from "@/components/inbox/inbox-client";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
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

  return (
    <InboxClient
      conversations={conversations}
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
