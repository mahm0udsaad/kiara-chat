import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The inbox list reads only LIST_METADATA_KEYS from conversations.metadata
// (src/lib/inbox.ts). A list helper that starts reading another key would get
// `undefined` there and quietly misfile conversations, so every key these
// helpers read must be on that list.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const inbox = read("src/lib/inbox.ts");
const listed = new Set(
  [...inbox.match(/LIST_METADATA_KEYS = \[([\s\S]*?)\] as const/)[1].matchAll(/"(\w+)"/g)].map((m) => m[1]),
);

const LIST_HELPERS = [
  "src/lib/mobile/conversations.ts",
  "src/lib/conversation-meta.ts",
  "src/lib/contact-outcome.ts",
  "src/lib/booking-stage.ts",
];
// Message metadata, read for the preview line — not conversation metadata.
const NOT_CONVERSATION_KEYS = new Set(["participant_name"]);

function keysRead(source) {
  const keys = new Set();
  // `metadata as { key?: … }` casts.
  for (const cast of source.matchAll(/metadata as \{([^}]*)\}/g)) {
    for (const key of cast[1].matchAll(/(\w+)\?:/g)) keys.add(key[1]);
  }
  // `type RoutingMeta = { section?: …; routed_to?: … }` in conversation-meta.
  for (const block of source.matchAll(/type \w*Meta = \{([^}]*)\}/g)) {
    for (const key of block[1].matchAll(/(\w+)\?:/g)) keys.add(key[1]);
  }
  return keys;
}

test("every conversation metadata key the inbox list reads is fetched", () => {
  const missing = [];
  for (const path of LIST_HELPERS) {
    for (const key of keysRead(read(path))) {
      if (!NOT_CONVERSATION_KEYS.has(key) && !listed.has(key)) missing.push(`${key} (${path})`);
    }
  }
  assert.deepEqual(missing, [], "add these to LIST_METADATA_KEYS in src/lib/inbox.ts");
});

test("the guard actually finds the keys it is meant to protect", () => {
  const found = new Set(LIST_HELPERS.flatMap((path) => [...keysRead(read(path))]));
  for (const key of ["cs_status", "section", "routed_to", "chat_kind", "contact_outcome"]) {
    assert.ok(found.has(key), `scanner no longer sees ${key}`);
  }
});
