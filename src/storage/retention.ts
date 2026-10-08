import type { ArchiveItem, ArchivePayload } from '../types.js';

export const MIB = 1024 * 1024;
export const STORAGE_LIMITS = {
  archiveDays: 45,
  archiveItems: 40_000,
  archiveBytes: 20 * MIB,
  snapshotBytes: 20 * MIB,
  cacheEntries: 20_000,
  cacheBytes: 4 * MIB,
  // A final safety margin, well below GitHub's 100 MiB rejection threshold.
  fileBytes: 50 * MIB,
} as const;

export function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function timestamp(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

// last_seen_at is deliberately excluded: repeatedly fetching an old headline
// must not renew its lifetime. Future/invalid publication dates use first_seen.
export function retentionTime(item: ArchiveItem, now: Date): number | null {
  const published = timestamp(item.published_at);
  if (published !== null && published <= now.getTime()) return published;
  const firstSeen = timestamp(item.first_seen_at);
  return firstSeen !== null && firstSeen <= now.getTime() ? firstSeen : null;
}

export function expireArchive(
  archive: Map<string, ArchiveItem>, now: Date, days: number
): number {
  if (!Number.isInteger(days) || days < 7) {
    throw new Error('archive-days must be an integer >= 7 (the site exposes a 7-day window)');
  }
  const cutoff = now.getTime() - days * 86_400_000;
  let removed = 0;
  for (const [id, item] of archive) {
    const time = retentionTime(item, now);
    if (time === null || time < cutoff) {
      archive.delete(id);
      removed++;
    }
  }
  return removed;
}

/** Keep a newest-first prefix within the exact UTF-8 JSON budget.
 * Oversized individual records are skipped so one bad source cannot block all
 * other news. build must produce JSON whose size is monotonic with items.
 */
export function boundPayload<T, P>(
  items: T[], build: (items: T[]) => P,
  maxBytes: number, maxItems: number = STORAGE_LIMITS.archiveItems
): { payload: P; items: T[]; bytes: number; dropped: number } {
  const emptyBytes = jsonBytes(build([]));
  if (!Number.isSafeInteger(maxBytes) || maxBytes < emptyBytes ||
      !Number.isSafeInteger(maxItems) || maxItems < 0) {
    throw new Error('Invalid JSON storage budget');
  }
  const candidates = items.filter(item => jsonBytes(build([item])) <= maxBytes)
    .slice(0, maxItems);
  let low = 0;
  let high = candidates.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (jsonBytes(build(candidates.slice(0, middle))) <= maxBytes) low = middle;
    else high = middle - 1;
  }
  const retained = candidates.slice(0, low);
  const payload = build(retained);
  return { payload, items: retained, bytes: jsonBytes(payload), dropped: items.length - low };
}

export function boundArchive(
  archive: Map<string, ArchiveItem>, now: Date,
  maxBytes: number = STORAGE_LIMITS.archiveBytes,
  maxItems: number = STORAGE_LIMITS.archiveItems
) {
  const sorted = Array.from(archive.values()).sort((a, b) =>
    (retentionTime(b, now) ?? 0) - (retentionTime(a, now) ?? 0) || a.id.localeCompare(b.id)
  );
  return boundPayload(sorted, (items): ArchivePayload => ({
    generated_at: now.toISOString(), total_items: items.length, items,
  }), maxBytes, maxItems);
}

/** Keep only translations referenced by retained headlines, newest first. */
export function boundTitleCache(
  cache: Map<string, string>, items: ArchiveItem[],
  maxBytes: number = STORAGE_LIMITS.cacheBytes,
  maxEntries: number = STORAGE_LIMITS.cacheEntries
) {
  const entries: Array<[string, string]> = [];
  const seen = new Set<string>();
  for (const item of items) {
    const key = item.title.trim();
    const value = cache.get(key);
    if (!seen.has(key) && typeof value === 'string' && value.trim()) {
      entries.push([key, value]);
      seen.add(key);
    }
  }
  const bounded = boundPayload(entries, (rows) => Object.fromEntries(rows), maxBytes, maxEntries);
  return { ...bounded, cache: new Map(bounded.items), removed: cache.size - bounded.items.length };
}
