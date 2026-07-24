/**
 * Runtime service status via systemctl (Linux), plus unmanaged process conflicts.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PxhConfig, RuntimeServiceInfo, ServiceTier } from '../types.js';
import { allServiceEntries } from '../types.js';
import {
  findExtraProcesses,
  getUnitOwnedPids,
  hasProcessMatcher,
  listHostProcesses,
  type ExtraProcess,
} from './processMatch.js';

const execFileAsync = promisify(execFile);

/** systemctl often exits non-zero for inactive/disabled; stdout is still useful. */
async function systemctlText(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('systemctl', args);
    return String(stdout).trim();
  } catch (err) {
    const out =
      err && typeof err === 'object' && 'stdout' in err
        ? String((err as { stdout?: Buffer | string }).stdout || '')
        : '';
    return out.trim();
  }
}

function normalizeEnabled(raw: string): RuntimeServiceInfo['enabled'] {
  const e = raw.trim();
  if (e === 'enabled' || e === 'disabled' || e === 'static' || e === 'masked') return e;
  if (e.includes('enabled')) return 'enabled';
  if (e.includes('disabled')) return 'disabled';
  if (e.includes('masked')) return 'masked';
  if (e.includes('static')) return 'static';
  return 'unknown';
}

export async function getRuntimeServices(cfg: PxhConfig): Promise<RuntimeServiceInfo[]> {
  const entries = allServiceEntries(cfg);
  const scan = cfg.services.scanConflicts !== false;
  const hostProcs = scan ? await listHostProcesses() : [];

  return Promise.all(
    entries.map(async (e) => {
      const info = await getOne(e.name, e.tier);
      if (!scan || !hasProcessMatcher(e.name)) {
        return { ...info, extraProcesses: [] as ExtraProcess[] };
      }
      const owned = await getUnitOwnedPids(e.name);
      const extraProcesses = findExtraProcesses(e.name, hostProcs, owned);
      return { ...info, extraProcesses };
    }),
  );
}

async function getOne(name: string, tier: ServiceTier): Promise<RuntimeServiceInfo> {
  if (process.platform !== 'linux') {
    return { name, tier, state: 'unknown', enabled: 'unknown', pid: null, extraProcesses: [] };
  }

  const stateRaw = await systemctlText(['is-active', name]);
  let state: RuntimeServiceInfo['state'] = 'unknown';
  if (stateRaw === 'active') state = 'running';
  else if (stateRaw === 'failed') state = 'failed';
  else if (stateRaw === 'inactive' || stateRaw === 'deactivating') state = 'stopped';
  else if (stateRaw === 'activating' || stateRaw === 'reloading') state = 'unknown';
  else if (stateRaw) {
    const result = await systemctlText(['show', '-p', 'Result', '--value', name]);
    if (result === 'failed') state = 'failed';
    else state = 'stopped';
  } else {
    // Unit missing / unreadable
    state = 'unknown';
  }

  const enRaw = await systemctlText(['is-enabled', name]);
  const enabled = normalizeEnabled(enRaw);

  let pid: number | null = null;
  const pidOut = await systemctlText(['show', '-p', 'MainPID', '--value', name]);
  const n = Number(pidOut);
  if (n > 0) pid = n;

  return { name, tier, state, enabled, pid, extraProcesses: [] };
}

/** Unit names allowlisted for start/stop/restart/enable/disable. */
export function allowlistedServiceNames(cfg: PxhConfig): string[] {
  return allServiceEntries(cfg).map((e) => e.name);
}
