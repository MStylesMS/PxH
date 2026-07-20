/**
 * Runtime service status via systemctl (Linux).
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PxhConfig, RuntimeServiceInfo, ServiceTier } from '../types.js';
import { allServiceEntries } from '../types.js';

const execFileAsync = promisify(execFile);

export async function getRuntimeServices(cfg: PxhConfig): Promise<RuntimeServiceInfo[]> {
  const entries = allServiceEntries(cfg);
  return Promise.all(entries.map((e) => getOne(e.name, e.tier)));
}

async function getOne(name: string, tier: ServiceTier): Promise<RuntimeServiceInfo> {
  if (process.platform !== 'linux') {
    return { name, tier, state: 'unknown', pid: null };
  }
  try {
    const { stdout: active } = await execFileAsync('systemctl', ['is-active', name]);
    const stateRaw = active.trim();
    let state: RuntimeServiceInfo['state'] = 'unknown';
    if (stateRaw === 'active') state = 'running';
    else if (stateRaw === 'failed') state = 'failed';
    else if (stateRaw === 'inactive' || stateRaw === 'deactivating') state = 'stopped';
    else {
      // activating, reloading, etc. — try Result
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

    return { name, tier, state, pid };
  } catch {
    return { name, tier, state: 'unknown', pid: null };
  }
}

/** Unit names allowlisted for start/stop/restart. */
export function allowlistedServiceNames(cfg: PxhConfig): string[] {
  return allServiceEntries(cfg).map((e) => e.name);
}
