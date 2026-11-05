import type { InfiniteData, QueryClient } from "@tanstack/react-query";

import { NEW_CONVERSATION_COUNT_KEY } from "@/lib/queries";

/**
 * How the inbox lists catch up when a message arrives.
 *
 * Every list request loads the whole inbox on the server, and one customer
 * message reaches every employee's phone — twice, as a live broadcast and as a
 * push. Refreshing everything on each of those was 400k list requests a month.
 * So:
 *
 * - bursts collapse into one refresh, a couple of seconds after the last event;
 * - only a list on screen refetches (the inbox passes `subscribed: false` when
 *   it is hidden); a hidden one is trimmed to its first page, so catching up
 *   when it is shown again is a single request, not one per page scrolled;
 * - the tab badge refreshes at most every 20 seconds, and not at all while the
 *   open inbox keeps it current from its own responses.
 *
 * An open conversation is not affected: its thread still updates at once.
 */

const LIST_REFRESH_DELAY_MS = 2_000;
const BADGE_REFRESH_MS = 20_000;

let listTimer: ReturnType<typeof setTimeout> | null = null;
let badgeTimer: ReturnType<typeof setTimeout> | null = null;

const isBadge = (key: readonly unknown[]) =>
  key[0] === NEW_CONVERSATION_COUNT_KEY[0] &&
  key[1] === NEW_CONVERSATION_COUNT_KEY[1] &&
  key[2] === NEW_CONVERSATION_COUNT_KEY[2];

function trimHiddenLists(queryClient: QueryClient) {
  for (const query of queryClient.getQueryCache().findAll({ queryKey: ["conversations"], type: "inactive" })) {
    if (isBadge(query.queryKey)) continue;
    queryClient.setQueryData<InfiniteData<unknown>>(query.queryKey, (data) =>
      data?.pages && data.pages.length > 1
        ? { pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) }
        : data,
    );
  }
}

function refreshBadge(queryClient: QueryClient) {
  const updatedAt = queryClient.getQueryState(NEW_CONVERSATION_COUNT_KEY)?.dataUpdatedAt ?? 0;
  const age = Date.now() - updatedAt;
  if (age >= BADGE_REFRESH_MS) {
    void queryClient.invalidateQueries({ queryKey: NEW_CONVERSATION_COUNT_KEY, exact: true });
    return;
  }
  // Fresh enough — often because the open inbox just wrote it. Look again
  // when it would be stale, in case nothing else has refreshed it by then.
  if (badgeTimer) return;
  badgeTimer = setTimeout(() => {
    badgeTimer = null;
    refreshBadge(queryClient);
  }, BADGE_REFRESH_MS - age);
}

/** Something changed in the inbox; catch the lists and badge up, cheaply. */
export function scheduleInboxRefresh(queryClient: QueryClient) {
  if (listTimer) return;
  listTimer = setTimeout(() => {
    listTimer = null;
    trimHiddenLists(queryClient);
    void queryClient
      .invalidateQueries({
        queryKey: ["conversations"],
        predicate: (query) => !isBadge(query.queryKey),
      })
      // After the visible list has answered, so its counts reach the badge
      // first and the badge rarely needs a request of its own.
      .finally(() => setTimeout(() => refreshBadge(queryClient), 500));
  }, LIST_REFRESH_DELAY_MS);
}

export function cancelInboxRefresh() {
  if (listTimer) clearTimeout(listTimer);
  if (badgeTimer) clearTimeout(badgeTimer);
  listTimer = null;
  badgeTimer = null;
}
