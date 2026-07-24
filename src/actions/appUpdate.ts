/**
 * Phase 2: checkout branch + hard-reset to a commit, then restart the unit.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import type { PxhConfig } from '../types.js';
import { resolveMappedApp } from '../runtime/appVersions.js';

const execFileAsync = promisify(execFile);

const FETCH_TIMEOUT_MS = 45_000;
const GIT_TIMEOUT_MS = 30_000;

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

export async function runAppUpdate(
  cfg: PxhConfig,
  name: string,
  branch: string,
  sha: string,
  confirm: boolean,
  onProgress?: (step: string) => void,
): Promise<{ ok: boolean; message: string }> {
  if (!cfg.actions.enabled || !cfg.actions.allowAppUpdate) {
    return { ok: false, message: 'App update disabled in pxh.ini' };
  }
  if (!confirm) {
    return { ok: false, message: 'confirm: true required' };
  }
  if (!name || !branch || !sha) {
    return { ok: false, message: 'name, branch, and sha required' };
  }
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
    return { ok: false, message: 'invalid sha' };
  }
  if (process.platform !== 'linux') {
    return { ok: false, message: 'App update is only supported on Linux' };
  }

  const entry = resolveMappedApp(cfg, name);
  if (!entry) {
    return { ok: false, message: `App unit ${name} is not mapped in [apps]` };
  }

  const cwd = resolve(entry.path);
  const progress = (step: string) => onProgress?.(step);

  try {
    progress('Checking work tree…');
    const inside = (await git(cwd, ['rev-parse', '--is-inside-work-tree'])).trim();
    if (inside !== 'true') {
      return { ok: false, message: 'not a git work tree' };
    }

    const dirty = (await git(cwd, ['status', '--porcelain'])).trim();
    if (dirty) {
      return { ok: false, message: 'working tree dirty — refuse update' };
    }

    progress('Fetching origin…');
    await git(cwd, ['fetch', '--prune', 'origin'], FETCH_TIMEOUT_MS);

    const remoteRef = `origin/${branch}`;
    try {
      await git(cwd, ['rev-parse', '--verify', remoteRef]);
    } catch {
      return { ok: false, message: `branch "${branch}" not found on origin` };
    }

    progress('Verifying commit on branch…');
    let fullSha: string;
    try {
      fullSha = (await git(cwd, ['rev-parse', '--verify', `${sha}^{commit}`])).trim();
    } catch {
      return { ok: false, message: `commit ${sha} not found` };
    }

    try {
      await execFileAsync(
        'git',
        ['-C', cwd, 'merge-base', '--is-ancestor', fullSha, remoteRef],
        {
          timeout: GIT_TIMEOUT_MS,
          env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: '0',
            GIT_OPTIONAL_LOCKS: '0',
          },
        },
      );
    } catch {
      return {
        ok: false,
        message: `commit ${fullSha.slice(0, 7)} is not on origin/${branch}`,
      };
    }

    progress(`Checking out ${branch}…`);
    // Local branch tracking origin/<branch>, then hard-reset to chosen SHA.
    try {
      await git(cwd, ['rev-parse', '--verify', `refs/heads/${branch}`]);
      await git(cwd, ['checkout', branch]);
    } catch {
      await git(cwd, ['checkout', '-B', branch, '--track', remoteRef]);
    }

    progress(`Resetting to ${fullSha.slice(0, 7)}…`);
    await git(cwd, ['reset', '--hard', fullSha]);

    progress(`Restarting ${name}…`);
    await execFileAsync('sudo', ['systemctl', 'restart', name], {
      timeout: 60_000,
    });

    return {
      ok: true,
      message: `Updated ${name} to ${branch} @ ${fullSha.slice(0, 7)} and restarted`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
