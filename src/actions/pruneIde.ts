/**
 * IDE remote-server prune — Cursor + VS Code stale builds.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';

const execFileAsync = promisify(execFile);

export interface PruneResult {
  ok: boolean;
  message: string;
  dryRun: boolean;
  kept: string[];
  deleted: string[];
  bytesReclaimed: number;
}

async function liveBuildPaths(): Promise<Set<string>> {
  const live = new Set<string>();
  try {
    const { stdout } = await execFileAsync('ps', ['aux'], { timeout: 10_000 });
    for (const line of stdout.split('\n')) {
      const m = line.match(
        /(\/(?:home\/[^/]+|\S+)\/\.(?:cursor-server|vscode-server)\/\S+)/,
      );
      if (m) {
        // Normalize to containing build dir if possible
        const p = m[1];
        live.add(p);
        const parts = p.split('/');
        const binIdx = parts.indexOf('bin');
        if (binIdx > 0 && parts[binIdx + 1]) {
          live.add(parts.slice(0, binIdx + 2).join('/'));
        }
        const serversIdx = parts.indexOf('servers');
        if (serversIdx > 0 && parts[serversIdx + 1]) {
          live.add(parts.slice(0, serversIdx + 2).join('/'));
        }
      }
    }
  } catch {
    /* */
  }
  return live;
}

function dirSizeBytes(path: string): number {
  let total = 0;
  try {
    const st = statSync(path);
    if (st.isFile()) return st.size;
    if (!st.isDirectory()) return 0;
    for (const name of readdirSync(path)) {
      total += dirSizeBytes(join(path, name));
    }
  } catch {
    return 0;
  }
  return total;
}

function listCursorBuilds(home: string): string[] {
  const root = join(home, '.cursor-server', 'bin', 'linux-arm64');
  if (!existsSync(root)) {
    // also try generic bin/*
    const bin = join(home, '.cursor-server', 'bin');
    if (!existsSync(bin)) return [];
    try {
      return readdirSync(bin)
        .map((n) => join(bin, n))
        .filter((p) => {
          try {
            return statSync(p).isDirectory();
          } catch {
            return false;
          }
        });
    } catch {
      return [];
    }
  }
  try {
    return readdirSync(root)
      .map((n) => join(root, n))
      .filter((p) => {
        try {
          return statSync(p).isDirectory();
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

function listVscodeBuilds(home: string): string[] {
  const out: string[] = [];
  const servers = join(home, '.vscode-server', 'cli', 'servers');
  if (existsSync(servers)) {
    try {
      for (const n of readdirSync(servers)) {
        if (n.startsWith('Stable-') || n.startsWith('code-')) {
          out.push(join(servers, n));
        }
      }
    } catch {
      /* */
    }
  }
  const cached = join(home, '.vscode-server', 'CachedExtensionVSIXs');
  if (existsSync(cached)) out.push(cached);
  return out.filter((p) => {
    try {
      return statSync(p).isDirectory() || statSync(p).isFile();
    } catch {
      return false;
    }
  });
}

function isLive(path: string, live: Set<string>): boolean {
  for (const l of live) {
    if (l === path || l.startsWith(path + '/') || path.startsWith(l + '/') || l.includes(basename(path))) {
      return true;
    }
  }
  return false;
}

export async function runIdePrune(dryRun: boolean): Promise<PruneResult> {
  const home = homedir();
  if (home.includes('/opt/paradox')) {
    return {
      ok: false,
      message: 'Refusing prune: unexpected home under /opt/paradox',
      dryRun,
      kept: [],
      deleted: [],
      bytesReclaimed: 0,
    };
  }

  const live = await liveBuildPaths();
  const candidates = [...listCursorBuilds(home), ...listVscodeBuilds(home)];
  const kept: string[] = [];
  const toDelete: string[] = [];

  for (const path of candidates) {
    if (path.startsWith('/opt/paradox')) continue;
    if (isLive(path, live)) kept.push(path);
    else toDelete.push(path);
  }

  let bytesReclaimed = 0;
  const deleted: string[] = [];

  if (dryRun) {
    for (const p of toDelete) bytesReclaimed += dirSizeBytes(p);
    return {
      ok: true,
      message: `Dry-run: would delete ${toDelete.length} path(s), keep ${kept.length}`,
      dryRun: true,
      kept,
      deleted: toDelete,
      bytesReclaimed,
    };
  }

  for (const p of toDelete) {
    const size = dirSizeBytes(p);
    try {
      rmSync(p, { recursive: true, force: true });
      deleted.push(p);
      bytesReclaimed += size;
    } catch (e) {
      return {
        ok: false,
        message: `Failed deleting ${p}: ${e instanceof Error ? e.message : String(e)}`,
        dryRun: false,
        kept,
        deleted,
        bytesReclaimed,
      };
    }
  }

  // Reset vscode lru.json if present (harmless when empty)
  const lru = join(home, '.vscode-server', 'data', 'lru.json');
  if (existsSync(lru) && deleted.length > 0) {
    try {
      writeFileSync(lru, '{}\n');
    } catch {
      /* */
    }
  }

  return {
    ok: true,
    message: `Pruned ${deleted.length} path(s), reclaimed ${Math.round(bytesReclaimed / 1e6)} MB`,
    dryRun: false,
    kept,
    deleted,
    bytesReclaimed,
  };
}

/** Exported for tests — parse lru without requiring live FS. */
export function readLruSafe(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}
