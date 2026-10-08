import { readFile } from 'fs/promises';
import type { ArchiveItem } from '../types.js';

export function parseArchive(content: string): Map<string, ArchiveItem> {
  const payload = JSON.parse(content);
  if (!payload || !payload.items || typeof payload.items !== 'object') {
    throw new Error('Invalid archive: expected an items array or legacy object');
  }
  const rows = Array.isArray(payload.items)
    ? payload.items : Object.entries(payload.items).map(([id, value]) => ({ ...(value as object), id }));
  const archive = new Map<string, ArchiveItem>();
  let invalid = 0;
  for (const row of rows) {
    if (!row || typeof row !== 'object' ||
        ['id', 'site_id', 'site_name', 'source', 'title', 'url'].some(key => typeof row[key] !== 'string')) {
      invalid++;
      continue;
    }
    archive.set(row.id, row);
  }
  if (invalid) console.warn(`Archive: skipped ${invalid} malformed records`);
  return archive;
}

export async function loadArchive(path: string): Promise<Map<string, ArchiveItem>> {
  try {
    return parseArchive(await readFile(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map();
    throw error; // Do not silently overwrite an unreadable/corrupt archive.
  }
}
