/**
 * Git-based version inventory for Paradox apps (Phase 1 — read-only).
 */

import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import type { AppCommitInfo, AppVersionInfo, PxhConfig } from '../types.js';

const execFileAsync = promisify(execFile);

const FETCH_TIMEOUT_MS = 45_000;
const GIT_TIMEOUT_MS = 15_000;
const MAX_NEWER_COMMITS = 50;

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
    let branch: string | null = null;
    try {
      const b = (await git(path, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
      branch = b === 'HEAD' ? null : b;
    } catch {
      branch = null;
    }

    const head = await readHeadCommit(path);
    base.branch = branch;
    base.head = head;

    try {
      await git(path, ['fetch', '--prune', 'origin'], FETCH_TIMEOUT_MS);
      base.fetchedAt = new Date().toISOString();
    } catch (e) {
      base.error = `git fetch failed: ${e instanceof Error ? e.message : String(e)}`;
      // Continue with local remotes if any
    }

    const remoteRefs = await git(path, [
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
    base.originBranches = [...new Set(originBranches)];

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

export async function getAppVersions(cfg: PxhConfig): Promise<AppVersionInfo[]> {
  const entries = mappedAppEntries(cfg);
  return Promise.all(entries.map((e) => probeOne(e.name, e.path)));
}
