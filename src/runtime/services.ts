/**
 * Runtime service status via systemctl (Linux).
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PxhConfig, RuntimeServiceInfo, ServiceTier } from '../types.js';
import { allServiceEntries } from '../types.js';

const execFileAsync = promisify(execFile);

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
  return Promise.all(entries.map((e) => getOne(e.name, e.tier)));
}

async function getOne(name: string, tier: ServiceTier): Promise<RuntimeServiceInfo> {
  if (process.platform !== 'linux') {
    return { name, tier, state: 'unknown', enabled: 'unknown', pid: null };
  }
  try {
    const { stdout: active } = await execFileAsync('systemctl', ['is-active', name]);
    const stateRaw = active.trim();
    let state: RuntimeServiceInfo['state'] = 'unknown';
    if (stateRaw === 'active') state = 'running';
    else if (stateRaw === 'failed') state = 'failed';
    else if (stateRaw === 'inactive' || stateRaw === 'deactivating') state = 'stopped';
    else {
      try {
        const { stdout: result } = await execFileAsync('systemctl', [
          'show',
          '-p',
          'Result',
          '--value',
          name,
        ]);
        if (result.trim() === 'failed') state = 'failed';
        else state = 'stopped';
      } catch {
        state = 'unknown';
      }
    }

    let enabled: RuntimeServiceInfo['enabled'] = 'unknown';
    try {
      const { stdout: en } = await execFileAsync('systemctl', ['is-enabled', name]);
      enabled = normalizeEnabled(en.trim());
    } catch (err) {
      const out =
        err && typeof err === 'object' && 'stdout' in err
          ? String((err as { stdout?: Buffer | string }).stdout || '').trim()
          : '';
      enabled = normalizeEnabled(out);
    }

    let pid: number | null = null;
    try {
      const { stdout: pidOut } = await execFileAsync('systemctl', [
        'show',
        '-p',
        'MainPID',
        '--value',
        name,
      ]);
      const n = Number(pidOut.trim());
      if (n > 0) pid = n;
    } catch {
      /* */
    }

    return { name, tier, state, enabled, pid };
  } catch {
    return { name, tier, state: 'unknown', enabled: 'unknown', pid: null };
  }
}

/** Unit names allowlisted for start/stop/restart/enable/disable. */
export function allowlistedServiceNames(cfg: PxhConfig): string[] {
  return allServiceEntries(cfg).map((e) => e.name);
}
