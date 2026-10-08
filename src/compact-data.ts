import { Command } from 'commander';
import { readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { loadArchive } from './storage/archive-reader.js';
import { boundArchive, boundTitleCache, expireArchive, STORAGE_LIMITS } from './storage/retention.js';
import { loadTitleZhCache } from './translate/google.js';
import { writeJson } from './output/json-writer.js';

// Offline maintenance: dry-run by default. Uses the same policy as fetch.
const program = new Command()
  .option('--output-dir <dir>', 'Data directory', 'data')
  .option('--archive-days <days>', 'Retention in days (minimum 7)', String(STORAGE_LIMITS.archiveDays))
  .option('--now <iso>', 'Clock for reproducible migration checks', new Date().toISOString())
  .option('--write', 'Persist compacted archive and cache')
  .parse();
const opts = program.opts();
const now = new Date(opts.now);
if (!Number.isFinite(now.getTime())) throw new Error('Invalid --now timestamp');
const outputDir = resolve(opts.outputDir);
const archivePath = join(outputDir, 'archive.json');
const cachePath = join(outputDir, 'title-zh-cache.json');
const archive = await loadArchive(archivePath);
const beforeItems = archive.size;
const expired = expireArchive(archive, now, Number(opts.archiveDays));
const bounded = boundArchive(archive, now);
let cache = new Map<string, string>();
try {
  cache = loadTitleZhCache(JSON.parse(await readFile(cachePath, 'utf8')));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
const boundedCache = boundTitleCache(cache, bounded.items);
console.log(JSON.stringify({
  dry_run: !opts.write, now: now.toISOString(), before_items: beforeItems,
  expired_items: expired, capacity_evicted: bounded.dropped,
  retained_items: bounded.items.length, archive_bytes: bounded.bytes,
  cache_removed: boundedCache.removed, cache_bytes: boundedCache.bytes,
}, null, 2));
if (opts.write) {
  await writeJson(archivePath, bounded.payload);
  await writeJson(cachePath, boundedCache.payload);
}
