import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { ArchiveItem } from '../src/types.js';
import { writeJson } from '../src/output/json-writer.js';

vi.mock('../src/fetchers/index.js', () => ({
  createAllFetchers: () => [{}],
  runFetcher: async () => ({
    items: [
      { siteId: 'test', siteName: 'Test', source: 'source', title: '人工智能新技术', url: 'https://example.com/new', publishedAt: new Date('2026-10-08T09:00:00Z'), meta: {} },
      { siteId: 'test', siteName: 'Test', source: 'source', title: '人工智能旧资讯', url: 'https://example.com/old', publishedAt: new Date('2026-07-01T00:00:00Z'), meta: {} },
    ],
    status: { site_id: 'test', site_name: 'Test', ok: true, item_count: 2, duration_ms: 1, error: null },
  }),
  fetchOpmlRss: vi.fn(),
  fetchWaytoagiRecent7d: async () => ({ count_7d: 0, updates_7d: [] }),
}));
vi.mock('../src/translate/index.js', async (importOriginal) => ({
  ...await importOriginal<object>(),
  addBilingualFields: async (itemsAi: ArchiveItem[], itemsAll: ArchiveItem[], cache: Map<string, string>) => ({ itemsAi, itemsAll, cache }),
}));

const directories: string[] = [];
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'ai-news-test-'));
  directories.push(path);
  return path;
}
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe('update pipeline (network mocked)', () => {
  it('migrates legacy data, survives repeated stale headlines, and writes consistent snapshots twice', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-08T10:00:00Z'));
    const dir = await directory();
    await writeFile(join(dir, 'archive.json'), JSON.stringify({ items: {} }));
    await writeFile(join(dir, 'title-zh-cache.json'), JSON.stringify({ unused: '过期缓存', '人工智能新技术': '新技术' }));
    const { main } = await import('../src/index.js');
    for (let i = 0; i < 2; i++) {
      expect(await main(['node', 'src/index.ts', '--output-dir', dir, '--rss-opml', join(dir, 'missing.opml'), '--translate-max-new', '0'])).toBe(0);
      const archive = JSON.parse(await readFile(join(dir, 'archive.json'), 'utf8'));
      const latest = JSON.parse(await readFile(join(dir, 'latest-7d.json'), 'utf8'));
      const status = JSON.parse(await readFile(join(dir, 'source-status.json'), 'utf8'));
      expect(archive.total_items).toBe(1);
      expect(archive.items[0].title).toBe('人工智能新技术');
      expect(latest.total_items).toBe(latest.items.length);
      expect(latest.archive_total).toBe(archive.total_items);
      expect(latest.site_stats.find((s: { site_id: string }) => s.site_id === 'test').count).toBe(1);
      expect(status.storage.expired_items).toBe(1);
      expect(status.storage.archive_bytes).toBe(Buffer.byteLength(await readFile(join(dir, 'archive.json'))));
      expect(JSON.parse(await readFile(join(dir, 'title-zh-cache.json'), 'utf8'))).toEqual({ '人工智能新技术': '新技术' });
    }
    expect((await readdir(dir)).some(name => name.endsWith('.tmp'))).toBe(false);
  });

  it('rejects invalid retention before fetching or writing', async () => {
    const dir = await directory();
    const { main } = await import('../src/index.js');
    await expect(main(['node', 'script', '--output-dir', dir, '--archive-days', 'oops'])).rejects.toThrow();
    expect(await readdir(dir)).toEqual([]);
  });
});

describe('atomic JSON writes', () => {
  it('writes compact valid JSON and leaves no temporary files', async () => {
    const dir = await directory();
    const path = join(dir, 'nested', 'data.json');
    await writeJson(path, { title: '汉字🙂' });
    expect(await readFile(path, 'utf8')).toBe('{"title":"汉字🙂"}');
    expect(await readdir(join(dir, 'nested'))).toEqual(['data.json']);
  });

  it('preserves the previous file when the final 50 MiB guard rejects a write', async () => {
    const dir = await directory();
    const path = join(dir, 'data.json');
    await writeJson(path, { previous: true });
    await expect(writeJson(path, 'x'.repeat(50 * 1024 * 1024))).rejects.toThrow('safe JSON file budget');
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ previous: true });
    expect(await readdir(dir)).toEqual(['data.json']);
  });
});
