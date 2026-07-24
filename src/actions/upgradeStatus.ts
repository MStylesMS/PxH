/**
 * Detached OS upgrade status (/run/pxh/upgrade-status.json) + launch helpers.
 */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const UPGRADE_STATUS_PATH = '/run/pxh/upgrade-status.json';
export const UPGRADE_UNIT = 'pxh-os-upgrade.service';

export type AptUpgradePhase = 'heal' | 'update' | 'upgrade' | 'done' | 'error' | string;

export interface AptUpgradeStatus {
  inProgress: boolean;
  phase: AptUpgradePhase;
  message: string;
  completed: number;
  total: number;
  startedAt: string | null;
  finishedAt: string | null;
  ok: boolean | null;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
/** apps/PxH root (dist/actions → ../.., src/actions → ../..) */
const APP_ROOT = resolve(__dirname, '../..');

export function upgradeLaunchScriptPath(): string {
  return resolve(APP_ROOT, 'scripts/os-upgrade-launch.sh');
}

export function parseUpgradeStatusJson(raw: string): AptUpgradeStatus | null {
  try {
    const data = JSON.parse(raw) as Partial<AptUpgradeStatus>;
    if (typeof data.inProgress !== 'boolean') return null;
    return {
      inProgress: data.inProgress,
      phase: typeof data.phase === 'string' ? data.phase : 'upgrade',
      message: typeof data.message === 'string' ? data.message : '',
      completed: Number.isFinite(Number(data.completed)) ? Number(data.completed) : 0,
      total: Number.isFinite(Number(data.total)) ? Number(data.total) : 0,
      startedAt: typeof data.startedAt === 'string' ? data.startedAt : null,
      finishedAt: typeof data.finishedAt === 'string' ? data.finishedAt : null,
      ok: data.ok === true ? true : data.ok === false ? false : null,
    };
  } catch {
    return null;
  }
}

export async function readUpgradeStatus(): Promise<AptUpgradeStatus | null> {
  try {
    const raw = await readFile(UPGRADE_STATUS_PATH, 'utf8');
    return parseUpgradeStatusJson(raw);
  } catch {
    return null;
  }
}

export async function isUpgradeUnitActive(): Promise<boolean> {
  if (process.platform !== 'linux') return false;
  try {
    const { stdout } = await execFileAsync('systemctl', ['is-active', UPGRADE_UNIT], {
      timeout: 5_000,
    });
    const s = stdout.trim();
    return s === 'active' || s === 'activating';
  } catch {
    // systemctl is-active returns non-zero when inactive
    return false;
  }
}

export async function isUpgradeInProgress(): Promise<boolean> {
  // Unit is authoritative — a stale status file must not block new upgrades
  return isUpgradeUnitActive();
}

/** Status for metrics/UI; clears stale inProgress when the unit is gone. */
export async function getAptUpgradeMetrics(): Promise<AptUpgradeStatus | null> {
  const st = await readUpgradeStatus();
  if (!st) return null;
  if (!st.inProgress) return st;
  if (await isUpgradeUnitActive()) return st;
  return {
    ...st,
    inProgress: false,
    phase: 'error',
    ok: false,
    message: st.message || 'Upgrade interrupted',
    finishedAt: st.finishedAt || new Date().toISOString(),
  };
}

let monitorTimer: ReturnType<typeof setInterval> | null = null;
let monitorStartedAt = 0;

/**
 * Poll upgrade status and emit WS-style progress until the unit finishes.
 * Safe to call multiple times — only one monitor runs.
 */
export function startUpgradeProgressMonitor(
  onEvent: (phase: 'progress' | 'done' | 'error', message: string) => void,
): void {
  if (monitorTimer) return;
  monitorStartedAt = Date.now();
  let lastMessage = '';

  monitorTimer = setInterval(() => {
    void (async () => {
      const [active, st] = await Promise.all([isUpgradeUnitActive(), readUpgradeStatus()]);
      const ageMs = Date.now() - monitorStartedAt;

      if (st?.inProgress) {
        const msg =
          st.total > 0
            ? `${st.message || 'Upgrade in progress'} (${st.completed}/${st.total})`
            : st.message || 'Upgrade in progress…';
        if (msg !== lastMessage) {
          lastMessage = msg;
          onEvent('progress', msg);
        }
        return;
      }

      // Allow a short grace period after launch before treating inactive as done/failed
      if (active || ageMs < 3_000) return;

      if (monitorTimer) {
        clearInterval(monitorTimer);
        monitorTimer = null;
      }

      if (st && st.ok === true) {
        onEvent('done', st.message || 'Upgrade finished');
        return;
      }
      if (st && st.ok === false) {
        onEvent('error', st.message || 'Upgrade failed');
        return;
      }
      if (st?.inProgress === false && st.phase === 'done') {
        onEvent('done', st.message || 'Upgrade finished');
        return;
      }
      onEvent(
        'error',
        st?.message ||
          'Upgrade stopped unexpectedly (timeout or failure). If apt is stuck: sudo dpkg --configure -a',
      );
    })();
  }, 2_000);
}
