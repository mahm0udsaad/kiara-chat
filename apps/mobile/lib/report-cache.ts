import { File, Paths } from "expo-file-system";

/**
 * The last customer service report per date range, kept on the phone so the
 * screen opens on it at once while a fresh copy loads behind it.
 *
 * Building this report reads every message in the range — seconds for a day,
 * longer for a month — and the owner used to stare at a spinner every time she
 * opened the tab. Wiped whenever a different person signs in (see the auth
 * provider), like the in-memory query cache.
 */
const MAX_ENTRIES = 6;

type Entry = { at: number; data: unknown };
type Store = Record<string, Entry>;

function storeFile() {
  return new File(Paths.cache, "kiara-report-cache.json");
}

function readStore(): Store {
  try {
    const file = storeFile();
    if (!file.exists) return {};
    const parsed = JSON.parse(file.textSync()) as Store;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function readCachedReport<T>(key: string): { at: number; data: T } | undefined {
  const entry = readStore()[key];
  return entry ? { at: entry.at, data: entry.data as T } : undefined;
}

export function writeCachedReport(key: string, data: unknown): void {
  try {
    const store = readStore();
    store[key] = { at: Date.now(), data };
    // Keep only the most recent ranges.
    const kept = Object.entries(store)
      .sort(([, a], [, b]) => b.at - a.at)
      .slice(0, MAX_ENTRIES);
    const file = storeFile();
    if (!file.exists) file.create({ intermediates: true });
    file.write(JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // A cache that cannot be written only costs the instant first paint.
  }
}

export function clearReportCache(): void {
  try {
    const file = storeFile();
    if (file.exists) file.delete();
  } catch {
    // Nothing to clear.
  }
}
