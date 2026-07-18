/**
 * Runtime service status via systemctl (Linux). Stubs on non-Linux.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { RuntimeServiceInfo } from '../types.js';

const execFileAsync = promisify(execFile);

export async function getRuntimeServices(names: string[]): Promise<RuntimeServiceInfo[]> {
  return Promise.all(names.map((name) => getOne(name)));
}

async function getOne(name: string): Promise<RuntimeServiceInfo> {
  if (process.platform !== 'linux') {
    return { name, state: 'unknown', pid: null };
  }
  try {
    const { stdout: active } = await execFileAsync('systemctl', ['is-active', name]);
    const stateRaw = active.trim();
    let state: RuntimeServiceInfo['state'] = 'unknown';
    if (stateRaw === 'active') state = 'running';
    else if (stateRaw === 'inactive' || stateRaw === 'failed') {
      state = stateRaw === 'failed' ? 'failed' : 'stopped';
    }

    let pid: number | null = null;
    try {
      const { stdout: pidOut } = await execFileAsync('systemctl', ['show', '-p', 'MainPID', '--value', name]);
      const n = Number(pidOut.trim());
      if (n > 0) pid = n;
    } catch { /* */ }

    return { name, state, pid };
  } catch {
    return { name, state: 'unknown', pid: null };
  }
}
