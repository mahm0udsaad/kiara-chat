import { File, Paths } from "expo-file-system";
import type { QueryClient } from "@tanstack/react-query";
import { useMemo, useSyncExternalStore } from "react";
import * as Crypto from "expo-crypto";

import { apiRequest } from "@/lib/api";
import {
  prune,
  restoreEntries,
  visibleEntries,
  type OutboxEntry,
} from "@/lib/outbox-core";
import { queryKeys } from "@/lib/queries";

/**
 * The chat outbox: every typed reply, from the tap on send until the thread
 * has the server's copy. Rules live in outbox-core.ts. This file holds them
 * for the whole app, so a send carries on, and a failure stays visible, after
 * she leaves the chat. It is saved to disk, so a failed message survives the
 * app closing too.
 */

let entries: OutboxEntry[] = [];
let loaded = false;
const listeners = new Set<() => void>();

function storeFile() {
  return new File(Paths.document, "kiara-outbox.json");
}

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const file = storeFile();
    if (file.exists) entries = restoreEntries(JSON.parse(file.textSync()), Date.now());
  } catch {
    entries = [];
  }
}

function commit(next: OutboxEntry[]) {
  entries = prune(next, Date.now());
  try {
    const file = storeFile();
    if (!file.exists) file.create({ intermediates: true });
    file.write(JSON.stringify(entries));
  } catch {
    // Still held in memory for this session; only a restart would lose it.
  }
  for (const listener of listeners) listener();
}

function update(key: string, patch: Partial<OutboxEntry>) {
  commit(entries.map((entry) => (entry.key === key ? { ...entry, ...patch } : entry)));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot() {
  load();
  return entries;
}

async function deliver(entry: OutboxEntry, queryClient: QueryClient) {
  try {
    const result = await apiRequest<{ messageId: string | null }>(
      `/conversations/${entry.conversationId}/reply`,
      {
        method: "POST",
        body: JSON.stringify({
          body: entry.text,
          idempotencyKey: entry.key,
          replyToMessageId: entry.replyToMessageId,
        }),
      },
    );
    update(entry.key, {
      state: "sent",
      messageId: result.messageId ?? undefined,
      error: undefined,
    });
    void queryClient.invalidateQueries({ queryKey: ["conversations"] });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.conversationMessages(entry.conversationId),
    });
    await queryClient.invalidateQueries({
      queryKey: queryKeys.conversation(entry.conversationId),
    });
  } catch (error) {
    update(entry.key, {
      state: "failed",
      error: error instanceof Error && error.message ? error.message : "تعذّر الإرسال",
    });
  }
}

/** Put a typed reply in the thread at once and start sending it. */
export function sendToOutbox(
  input: { conversationId: string; text: string; replyToMessageId?: string },
  queryClient: QueryClient,
) {
  load();
  const entry: OutboxEntry = {
    key: Crypto.randomUUID(),
    conversationId: input.conversationId,
    text: input.text,
    replyToMessageId: input.replyToMessageId,
    createdAt: new Date().toISOString(),
    state: "sending",
  };
  commit([...entries, entry]);
  void deliver(entry, queryClient);
}

/** Send a failed entry again under the same key. */
export function retryOutboxEntry(key: string, queryClient: QueryClient) {
  load();
  const entry = entries.find((candidate) => candidate.key === key);
  if (!entry || entry.state === "sending") return;
  const retrying = { ...entry, state: "sending" as const, error: undefined };
  update(key, retrying);
  void deliver(retrying, queryClient);
}

/** Throw a failed entry away; she decided not to send it. */
export function discardOutboxEntry(key: string) {
  load();
  commit(entries.filter((entry) => entry.key !== key));
}

/** This thread's entries not yet in the thread itself, oldest first. */
export function useOutbox(conversationId: string, threadMessageIds: ReadonlySet<string>) {
  const all = useSyncExternalStore(subscribe, snapshot, snapshot);
  return useMemo(
    () => visibleEntries(all, conversationId, threadMessageIds),
    [all, conversationId, threadMessageIds],
  );
}
