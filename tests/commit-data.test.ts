import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, openSync, ftruncateSync, closeSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

const script = resolve('scripts/commit-data.sh');
const folders: string[] = [];
function fixture() {
  const folder = mkdtempSync(join(tmpdir(), 'ai-news-git-'));
  folders.push(folder);
  const repo = join(folder, 'repo');
  const remote = join(folder, 'remote.git');
  mkdirSync(repo);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  writeFileSync(join(repo, 'README.md'), 'fixture');
  git('add', '.');
  git('commit', '-m', 'init');
  execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' });
  git('remote', 'add', 'origin', remote);
  git('push', '-u', 'origin', 'main');
  mkdirSync(join(repo, 'data'));
  for (const name of ['latest-24h', 'latest-7d', 'archive', 'source-status', 'waytoagi-7d', 'title-zh-cache', 'opml-feeds']) {
    writeFileSync(join(repo, 'data', `${name}.json`), '{}');
  }
  const run = () => execFileSync('bash', [script], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { repo, remote, git, run };
}
afterEach(() => folders.splice(0).forEach(folder => rmSync(folder, { recursive: true, force: true })));

describe('generated data persistence', () => {
  it('commits untracked-only data, excludes unrelated staged files, and skips unchanged data', () => {
    const { repo, git, run } = fixture();
    writeFileSync(join(repo, 'private.txt'), 'do not publish');
    git('add', 'private.txt');
    run();
    expect(git('ls-tree', '--name-only', 'HEAD')).not.toContain('private.txt');
    expect(git('ls-tree', '-r', '--name-only', 'HEAD', 'data').split('\n')).toHaveLength(7);
    const sha = git('rev-parse', 'HEAD');
    expect(run()).toContain('No data changes');
    expect(git('rev-parse', 'HEAD')).toBe(sha);
  });

  it('rejects an oversized file before creating any commit', () => {
    const { repo, git, run } = fixture();
    const before = git('rev-parse', 'HEAD');
    const fd = openSync(join(repo, 'data', 'archive.json'), 'w');
    ftruncateSync(fd, 50 * 1024 * 1024 + 1);
    closeSync(fd);
    expect(run).toThrow();
    expect(git('rev-parse', 'HEAD')).toBe(before);
    expect(git('diff', '--cached', '--name-only')).toBe('');
  });

  it('reports push rejection without overwriting the remote', () => {
    const { repo, remote, git, run } = fixture();
    // Simulate a concurrent upstream commit in another checkout.
    const other = join(repo, '..', 'other');
    execFileSync('git', ['clone', '--branch', 'main', remote, other], { stdio: 'ignore' });
    for (const [key, value] of [['user.name', 'Other'], ['user.email', 'other@example.com']]) {
      execFileSync('git', ['config', key, value], { cwd: other });
    }
    writeFileSync(join(other, 'upstream-fix.txt'), 'preserve me');
    execFileSync('git', ['add', '.'], { cwd: other });
    execFileSync('git', ['commit', '-m', 'upstream fix'], { cwd: other, stdio: 'ignore' });
    execFileSync('git', ['push'], { cwd: other, stdio: 'ignore' });
    const upstream = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: other, encoding: 'utf8' }).trim();
    expect(run).toThrow();
    expect(git('ls-remote', 'origin', 'refs/heads/main').split('\t')[0]).toBe(upstream);
  });
});
