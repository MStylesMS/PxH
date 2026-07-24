/**
 * Git-based version inventory for Paradox apps (Phase 1 read + Phase 2 commit lists).
 */

import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import type {
  AppBranchCommits,
  AppCommitInfo,
  AppVersionInfo,
  CommitSelectOption,
  PxhConfig,
} from '../types.js';

const execFileAsync = promisify(execFile);

const FETCH_TIMEOUT_MS = 45_000;
const GIT_TIMEOUT_MS = 15_000;
const MAX_NEWER_COMMITS = 50;
const MAX_BRANCH_LOG = 50;

async function git(
  cwd: string,
  args: string[],
  timeoutMs = GIT_TIMEOUT_MS,
): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], {
    timeout: timeoutMs,
    maxBuffer: 4 * 1024 * 1024,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_OPTIONAL_LOCKS: '0',
    },
  });
  return String(stdout);
}

function emptyInfo(
  name: string,
  path: string,
  partial: Partial<AppVersionInfo> = {},
): AppVersionInfo {
  return {
    name,
    path,
    present: false,
    git: false,
    branch: null,
    head: null,
    remote: 'origin',
    originUrl: null,
    originBranches: [],
    behind: null,
    ahead: null,
    newerCommits: [],
    fetchedAt: null,
    error: null,
    ...partial,
  };
}

function parseCommitRecords(raw: string): AppCommitInfo[] {
  if (!raw.trim()) return [];
  const out: AppCommitInfo[] = [];
  for (const rec of raw.split('\x1e')) {
    const t = rec.trim();
    if (!t) continue;
    const [sha, short, subject, author, date, body] = t.split('\x1f');
    if (!sha) continue;
    out.push({
      sha,
      short: short || sha.slice(0, 7),
      subject: subject || '',
      body: (body || '').trim(),
      author: author || '',
      date: date || '',
    });
  }
  return out;
}

async function readHeadCommit(cwd: string): Promise<AppCommitInfo | null> {
  const raw = await git(
    cwd,
    ['log', '-1', '--format=%H%x1f%h%x1f%s%x1f%an%x1f%cI%x1f%b%x1e', 'HEAD'],
  );
  return parseCommitRecords(raw)[0] ?? null;
}

async function readOriginUrl(cwd: string): Promise<string | null> {
  try {
    const url = (await git(cwd, ['remote', 'get-url', 'origin'])).trim();
    return url || null;
  } catch {
    return null;
  }
}

async function listOriginBranches(cwd: string): Promise<string[]> {
  const remoteRefs = await git(cwd, [
    'for-each-ref',
    '--format=%(refname:short)',
    'refs/remotes/origin',
  ]);
  const originBranches = remoteRefs
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && l !== 'origin' && l !== 'origin/HEAD')
    .map((l) => (l.startsWith('origin/') ? l.slice('origin/'.length) : l))
    .filter((l) => l && l !== 'HEAD')
    .sort((a, b) => a.localeCompare(b));
  return [...new Set(originBranches)];
}

async function readCurrentBranch(cwd: string): Promise<string | null> {
  try {
    const b = (await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    return b === 'HEAD' ? null : b;
  } catch {
    return null;
  }
}

function commitMatchesSha(c: AppCommitInfo, headKey: string): boolean {
  return c.sha === headKey || c.sha.startsWith(headKey) || headKey.startsWith(c.sha);
}

/**
 * Shape the update-modal commit dropdown.
 * - Up to 5 newest on origin/<branch>; machine HEAD bold when present in that window.
 * - On the current branch, if HEAD is not in that window: 4 newest, gap, then HEAD (bold).
 * - Other branches: do not force-append machine HEAD.
 */
export function shapeCommitSelectOptions(args: {
  commits: AppCommitInfo[];
  head: AppCommitInfo | null;
  headSha: string | null;
  behind: number | null;
  selectedBranch: string;
  currentBranch: string | null;
}): CommitSelectOption[] {
  const { commits, head, headSha, behind, selectedBranch, currentBranch } = args;
  const headKey = headSha || head?.sha || null;
  const window = commits.slice(0, 5);
  const headInWindow =
    !!headKey && window.some((c) => commitMatchesSha(c, headKey));

  if (headInWindow) {
    return window.map((c) => ({
      kind: 'commit' as const,
      commit: c,
      current: !!headKey && commitMatchesSha(c, headKey),
    }));
  }

  const onCurrentBranch =
    !!headKey && currentBranch != null && selectedBranch === currentBranch;

  if (onCurrentBranch) {
    const top = commits.slice(0, 4);
    const headIdx = commits.findIndex((c) => commitMatchesSha(c, headKey));
    const more =
      headIdx >= 4
        ? headIdx - 4
        : behind != null && behind > 4
          ? behind - 4
          : 1;
    const current =
      head ||
      (headIdx >= 0 ? commits[headIdx]! : null);
    const out: CommitSelectOption[] = top.map((c) => ({
      kind: 'commit' as const,
      commit: c,
      current: false,
    }));
    if (more > 0) out.push({ kind: 'gap', more });
    if (current) {
      out.push({ kind: 'commit', commit: current, current: true });
    }
    return out;
  }

  return window.map((c) => ({
    kind: 'commit' as const,
    commit: c,
    current: !!headKey && commitMatchesSha(c, headKey),
  }));
}

async function probeOne(name: string, appPath: string): Promise<AppVersionInfo> {
  const path = resolve(appPath);
  if (!existsSync(path)) {
    return emptyInfo(name, path, {
      present: false,
      error: 'path not found',
    });
  }

  try {
    const inside = (await git(path, ['rev-parse', '--is-inside-work-tree'])).trim();
    if (inside !== 'true') {
      return emptyInfo(name, path, {
        present: true,
        git: false,
        error: 'not a git work tree',
      });
    }
  } catch (e) {
    return emptyInfo(name, path, {
      present: true,
      git: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  const base: AppVersionInfo = emptyInfo(name, path, {
    present: true,
    git: true,
  });

  try {
    const branch = await readCurrentBranch(path);
    const head = await readHeadCommit(path);
    base.branch = branch;
    base.head = head;
    base.originUrl = await readOriginUrl(path);

    try {
      await git(path, ['fetch', '--prune', 'origin'], FETCH_TIMEOUT_MS);
      base.fetchedAt = new Date().toISOString();
    } catch (e) {
      base.error = `git fetch failed: ${e instanceof Error ? e.message : String(e)}`;
      // Continue with local remotes if any
    }

    base.originBranches = await listOriginBranches(path);

    if (branch && base.originBranches.includes(branch)) {
      const remoteRef = `origin/${branch}`;
      try {
        const behindStr = (
          await git(path, ['rev-list', '--count', `HEAD..${remoteRef}`])
        ).trim();
        const aheadStr = (
          await git(path, ['rev-list', '--count', `${remoteRef}..HEAD`])
        ).trim();
        base.behind = Number(behindStr) || 0;
        base.ahead = Number(aheadStr) || 0;
      } catch (e) {
        base.error =
          (base.error ? `${base.error}; ` : '') +
          `compare failed: ${e instanceof Error ? e.message : String(e)}`;
      }

      if ((base.behind ?? 0) > 0) {
        try {
          const logRaw = await git(path, [
            'log',
            `HEAD..${remoteRef}`,
            `--max-count=${MAX_NEWER_COMMITS}`,
            '--format=%H%x1f%h%x1f%s%x1f%an%x1f%cI%x1f%b%x1e',
          ]);
          base.newerCommits = parseCommitRecords(logRaw);
        } catch (e) {
          base.error =
            (base.error ? `${base.error}; ` : '') +
            `log failed: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
    } else if (branch) {
      base.error =
        (base.error ? `${base.error}; ` : '') +
        `branch "${branch}" not found on origin`;
    } else {
      base.error =
        (base.error ? `${base.error}; ` : '') +
        'detached HEAD — no branch compare';
    }

    return base;
  } catch (e) {
    return {
      ...base,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Units that have an [apps] path and appear in the services allowlist. */
export function mappedAppEntries(
  cfg: PxhConfig,
): Array<{ name: string; path: string }> {
  const allow = new Set([
    ...cfg.services.required,
    ...cfg.services.optional,
    ...cfg.services.user,
  ]);
  const out: Array<{ name: string; path: string }> = [];
  for (const [name, path] of Object.entries(cfg.apps)) {
    if (!allow.has(name)) continue;
    if (!path) continue;
    out.push({ name, path });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function resolveMappedApp(
  cfg: PxhConfig,
  name: string,
): { name: string; path: string } | null {
  return mappedAppEntries(cfg).find((e) => e.name === name) ?? null;
}

export async function getAppVersions(cfg: PxhConfig): Promise<AppVersionInfo[]> {
  const entries = mappedAppEntries(cfg);
  return Promise.all(entries.map((e) => probeOne(e.name, e.path)));
}

/** Recent commits on origin/<branch> for the update modal. */
export async function getAppBranchCommits(
  cfg: PxhConfig,
  name: string,
  branch: string,
): Promise<AppBranchCommits> {
  const entry = resolveMappedApp(cfg, name);
  if (!entry) {
    return {
      name,
      path: '',
      branch,
      originUrl: null,
      currentBranch: null,
      headSha: null,
      head: null,
      behind: null,
      commits: [],
      fetchedAt: null,
      error: 'unknown or unmapped app unit',
    };
  }

  const path = resolve(entry.path);
  const fail = (error: string): AppBranchCommits => ({
    name,
    path,
    branch,
    originUrl: null,
    currentBranch: null,
    headSha: null,
    head: null,
    behind: null,
    commits: [],
    fetchedAt: null,
    error,
  });

  if (!existsSync(path)) return fail('path not found');

  try {
    const inside = (await git(path, ['rev-parse', '--is-inside-work-tree'])).trim();
    if (inside !== 'true') return fail('not a git work tree');
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }

  const currentBranch = await readCurrentBranch(path);
  const head = await readHeadCommit(path);
  const originUrl = await readOriginUrl(path);
  let fetchedAt: string | null = null;
  let error: string | null = null;

  try {
    await git(path, ['fetch', '--prune', 'origin'], FETCH_TIMEOUT_MS);
    fetchedAt = new Date().toISOString();
  } catch (e) {
    error = `git fetch failed: ${e instanceof Error ? e.message : String(e)}`;
  }

  const remoteRef = `origin/${branch}`;
  try {
    await git(path, ['rev-parse', '--verify', remoteRef]);
  } catch {
    return {
      name,
      path,
      branch,
      originUrl,
      currentBranch,
      headSha: head?.sha ?? null,
      head,
      behind: null,
      commits: [],
      fetchedAt,
      error: error
        ? `${error}; branch "${branch}" not found on origin`
        : `branch "${branch}" not found on origin`,
    };
  }

  let behind: number | null = null;
  try {
    const behindStr = (
      await git(path, ['rev-list', '--count', `HEAD..${remoteRef}`])
    ).trim();
    behind = Number(behindStr) || 0;
  } catch {
    behind = null;
  }

  let commits: AppCommitInfo[] = [];
  try {
    const logRaw = await git(path, [
      'log',
      remoteRef,
      `--max-count=${MAX_BRANCH_LOG}`,
      '--format=%H%x1f%h%x1f%s%x1f%an%x1f%cI%x1f%b%x1e',
    ]);
    commits = parseCommitRecords(logRaw);
  } catch (e) {
    error =
      (error ? `${error}; ` : '') +
      `log failed: ${e instanceof Error ? e.message : String(e)}`;
  }

  return {
    name,
    path,
    branch,
    originUrl,
    currentBranch,
    headSha: head?.sha ?? null,
    head,
    behind,
    commits,
    fetchedAt,
    error,
  };
}
