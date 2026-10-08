import { describe, expect, it } from 'vitest';
import type { ArchiveItem } from '../src/types.js';
import { parseArchive } from '../src/storage/archive-reader.js';
import { expireArchive, boundArchive, boundTitleCache, jsonBytes, retentionTime } from '../src/storage/retention.js';

const now = new Date('2026-10-08T10:00:00Z');
function item(id: string, overrides: Partial<ArchiveItem> = {}): ArchiveItem {
  return {
    id, site_id: 'test', site_name: '测试', source: 'source', title: `标题 ${id}`,
    url: `https://example.com/${id}`, published_at: now.toISOString(),
    first_seen_at: now.toISOString(), last_seen_at: now.toISOString(), ...overrides,
  };
}

describe('rolling archive retention', () => {
  it('does not renew old articles when they are seen again', () => {
    const stale = item('stale', { published_at: '2026-07-01T00:00:00Z' });
    const undated = item('undated', { published_at: null, first_seen_at: '2026-07-01T00:00:00Z' });
    const fresh = item('fresh');
    const archive = new Map([stale, undated, fresh].map(row => [row.id, row]));
    expect(expireArchive(archive, now, 45)).toBe(2);
    expect([...archive.keys()]).toEqual(['fresh']);
  });

  it('keeps the inclusive cutoff and expires one millisecond before it', () => {
    const cutoff = now.getTime() - 45 * 86_400_000;
    const archive = new Map([
      ['boundary', item('boundary', { published_at: new Date(cutoff).toISOString() })],
      ['expired', item('expired', { published_at: new Date(cutoff - 1).toISOString() })],
    ]);
    expect(expireArchive(archive, now, 45)).toBe(1);
    expect(archive.has('boundary')).toBe(true);
  });

  it('cannot make missing, invalid or future dates immortal', () => {
    const invalid = item('invalid', { published_at: 'bad', first_seen_at: 'bad' });
    const future = item('future', { published_at: '2099-01-01', first_seen_at: '2026-07-01' });
    expect(retentionTime(invalid, now)).toBeNull();
    const archive = new Map([invalid, future].map(row => [row.id, row]));
    expect(expireArchive(archive, now, 45)).toBe(2);
    expect(() => expireArchive(archive, now, NaN)).toThrow();
    expect(() => expireArchive(archive, now, 6)).toThrow();
  });

  it('migrates array and legacy object archives and rejects corrupt JSON', () => {
    const record = item('a');
    expect(parseArchive(JSON.stringify({ items: [record] })).get('a')).toEqual(record);
    expect(parseArchive(JSON.stringify({ items: { a: record } })).get('a')).toEqual(record);
    expect(() => parseArchive('{bad')).toThrow();
    expect(() => parseArchive('{}')).toThrow();
  });
});

describe('exact storage bounds', () => {
  it('keeps newest items under a count cap, independently of last_seen_at', () => {
    const archive = new Map(['b', 'a', 'c'].map((id, i) => [id, item(id, {
      published_at: new Date(now.getTime() - i * 86_400_000).toISOString(),
      last_seen_at: new Date(now.getTime() + i).toISOString(),
    })]));
    const result = boundArchive(archive, now, 10_000, 2);
    expect(result.items.map(row => row.id)).toEqual(['b', 'a']);
    expect(result.payload.total_items).toBe(2);
    expect(result.dropped).toBe(1);
  });

  it('counts escaped JSON and multilingual UTF-8 bytes exactly, including metadata', () => {
    const archive = new Map(['a', 'b', 'c'].map(id => [id, item(id, { title: '汉字🙂\n"'.repeat(10) })]));
    const full = boundArchive(archive, now);
    const exactTwo = boundArchive(archive, now, full.bytes, 2).bytes;
    const two = boundArchive(archive, now, exactTwo);
    expect(two.items).toHaveLength(2);
    expect(two.bytes).toBe(exactTwo);
    expect(Buffer.byteLength(JSON.stringify(two.payload))).toBe(two.bytes);
    expect(boundArchive(archive, now, exactTwo - 1).items).toHaveLength(1);
  });

  it('skips one enormous record and continues with healthy fresh records', () => {
    const archive = new Map([
      ['a', item('a', { title: 'x'.repeat(10_000) })], ['b', item('b')],
    ]);
    const result = boundArchive(archive, now, 1000);
    expect(result.items.map(row => row.id)).toEqual(['b']);
    expect(result.bytes).toBeLessThanOrEqual(1000);
    expect(result.dropped).toBe(1);
  });

  it('handles an empty archive and rejects impossible budgets', () => {
    const empty = boundArchive(new Map(), now);
    expect(empty.payload.total_items).toBe(0);
    expect(boundArchive(new Map(), now, empty.bytes).bytes).toBe(empty.bytes);
    expect(() => boundArchive(new Map(), now, empty.bytes - 1)).toThrow();
  });

  it('cleans orphan translations, caps count and bytes, safely keeps __proto__', () => {
    const cache = new Map([['__proto__', '原型'], ['标题 b', '你好🙂'], ['orphan', '过期']]);
    const rows = [item('a', { title: '__proto__' }), item('b')];
    const one = boundTitleCache(cache, rows, 1000, 1);
    expect([...one.cache.keys()]).toEqual(['__proto__']);
    expect(one.removed).toBe(2);
    expect(one.bytes).toBe(jsonBytes(one.payload));
    expect(Object.hasOwn(one.payload, '__proto__')).toBe(true);
    const small = boundTitleCache(cache, rows, one.bytes);
    expect(small.bytes).toBeLessThanOrEqual(one.bytes);
    expect(small.cache.size).toBe(1);
  });
});
