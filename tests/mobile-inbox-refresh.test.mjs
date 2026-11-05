import { afterEach, describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryObserver, InfiniteQueryObserver } from "../apps/mobile/node_modules/@tanstack/query-core/build/modern/index.js";

const BADGE = ["conversations", "count", "new"];
// The real module pulls in the whole React Native query layer for one constant.
mock.module("@/lib/queries", () => ({ NEW_CONVERSATION_COUNT_KEY: BADGE }));
const { scheduleInboxRefresh, cancelInboxRefresh } = await import(
  "../apps/mobile/lib/inbox-refresh.ts"
);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false } } });
  const fetches = { visible: 0, hidden: 0, badge: 0 };
  const page = (n) => ({ counts: { new: n }, conversations: { items: [], nextOffset: n } });
  const list = (key, counter) =>
    new InfiniteQueryObserver(client, {
      queryKey: ["conversations", key],
      initialPageParam: 0,
      queryFn: async ({ pageParam }) => {
        fetches[counter] += 1;
        return page(pageParam + 1);
      },
      getNextPageParam: (last) => last.conversations.nextOffset,
    });
  return { client, fetches, list };
}

afterEach(() => cancelInboxRefresh());

describe("inbox refresh after incoming messages", () => {
  test("a burst of 10 events reloads the visible list once", async () => {
    const { fetches, list, client } = setup();
    const visible = list("all", "visible");
    const unsubscribe = visible.subscribe(() => {});
    await wait(10);
    fetches.visible = 0;
    for (let i = 0; i < 10; i += 1) scheduleInboxRefresh(client);
    await wait(2_300);
    expect(fetches.visible).toBe(1);
    unsubscribe();
  });

  test("a hidden list is not reloaded, and is trimmed to its first page", async () => {
    const { fetches, list, client } = setup();
    const hidden = list("mine", "hidden");
    const unsubscribe = hidden.subscribe(() => {});
    await wait(10);
    await hidden.fetchNextPage();
    await hidden.fetchNextPage();
    unsubscribe(); // the screen went to a chat
    expect(client.getQueryData(["conversations", "mine"]).pages.length).toBe(3);
    fetches.hidden = 0;
    scheduleInboxRefresh(client);
    await wait(2_300);
    expect(fetches.hidden).toBe(0);
    expect(client.getQueryData(["conversations", "mine"]).pages.length).toBe(1);
    // Shown again: one request catches it up, not three.
    const back = list("mine", "hidden");
    const unsubscribeBack = back.subscribe(() => {});
    await wait(50);
    expect(fetches.hidden).toBe(1);
    unsubscribeBack();
  });

  test("the badge is not asked again while it is under 20 seconds old", async () => {
    const { fetches, client } = setup();
    const badge = new QueryObserver(client, {
      queryKey: BADGE,
      queryFn: async () => {
        fetches.badge += 1;
        return 3;
      },
      staleTime: 20_000,
    });
    const unsubscribe = badge.subscribe(() => {});
    await wait(10);
    fetches.badge = 0;
    scheduleInboxRefresh(client);
    await wait(2_800);
    expect(fetches.badge).toBe(0);
    unsubscribe();
  });

  test("a badge older than 20 seconds is refreshed after the list", async () => {
    const { fetches, client } = setup();
    client.setQueryData(BADGE, 3, { updatedAt: Date.now() - 25_000 });
    const badge = new QueryObserver(client, {
      queryKey: BADGE,
      queryFn: async () => {
        fetches.badge += 1;
        return 4;
      },
      staleTime: 20_000,
      refetchOnMount: false,
    });
    const unsubscribe = badge.subscribe(() => {});
    fetches.badge = 0;
    scheduleInboxRefresh(client);
    await wait(2_800);
    expect(fetches.badge).toBe(1);
    unsubscribe();
  });
});
