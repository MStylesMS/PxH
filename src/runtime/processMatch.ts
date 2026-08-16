/**
 * Detect Paradox (and known system) processes that match a configured unit
 * but are not members of that unit's systemd cgroup — common when a lab/dev
 * copy is running alongside or instead of the service.
 */

import { readFileSync, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ProcessRow {
  pid: number;
  cmd: string;
}

export interface ExtraProcess {
  pid: number;
  cmd: string;
}

/** Unit name → cmdline predicate. Units without a matcher are not scanned. */
const MATCHERS: Record<string, (cmd: string) => boolean> = {
  // Anchor at argv0 so shells whose -c text merely mentions these paths are ignored.
  pfx: (c) =>
    /^\s*(?:\S*\/)?node(?:js)?\s+\S*\/apps\/PFx\/pfx\.js(?:\s|$)/.test(c),
  pxo: (c) =>
    /^\s*(?:\S*\/)?node(?:js)?\s+\S*\/apps\/PxO\/src\/game\.js(?:\s|$)/.test(c),
  /** Legacy unit name (pre-rename); still recognize game.js processes. */
  'moscow-game': (c) =>
    /^\s*(?:\S*\/)?node(?:js)?\s+\S*\/apps\/PxO\/src\/game\.js(?:\s|$)/.test(c),
  pxio: (c) =>
    /^\s*(?:\/\S+\/)?pxio\s+--config(?:\s|=|$)/.test(c)
    || /^\s*(?:\/\S+\/)?pio\s+--config(?:\s|=|$)/.test(c),
  /** Legacy unit name before Pio→PxIO rename */
  pio: (c) =>
    /^\s*(?:\/\S+\/)?pxio\s+--config(?:\s|=|$)/.test(c)
    || /^\s*(?:\/\S+\/)?pio\s+--config(?:\s|=|$)/.test(c),
  pxb: (c) =>
    /^\s*(?:\S*\/)?node(?:js)?\s+\S*\/apps\/PxB\//.test(c),
  pxt: (c) =>
    /^\s*(?:\S*\/)?node(?:js)?\s+\S*\/apps\/PxT\//.test(c),
  pfxe: (c) =>
    /^\s*(?:\S*\/)?node(?:js)?\s+\S*\/apps\/PFXe?\//.test(c)
    || /^\s*(?:\S*\/)?node(?:js)?\s+\S*pfxe\.js(?:\s|$)/.test(c),
  'paradox-health': (c) =>
    /^\s*(?:\S*\/)?node(?:js)?\s+\S*\/apps\/PxH\/(?:dist\/index\.js|src\/index\.(?:js|ts))(?:\s|$)/.test(c),
  mosquitto: (c) =>
    /^\s*\/usr\/sbin\/mosquitto(?:\s|$)/.test(c)
    || /^\s*mosquitto\s+-c\s/.test(c),
  nginx: (c) => /^\s*\/usr\/sbin\/nginx(?:\s|$)/.test(c),
};

export function hasProcessMatcher(unit: string): boolean {
  return Object.prototype.hasOwnProperty.call(MATCHERS, unit);
}

export function cmdlineMatchesUnit(unit: string, cmd: string): boolean {
  const fn = MATCHERS[unit];
  return fn ? fn(cmd) : false;
}

/** Truncate for API/UI; keep start of cmdline (binary + args). */
export function shortCmd(cmd: string, max = 120): string {
  const t = cmd.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function listProcessesFromPs(stdout: string): ProcessRow[] {
  const out: ProcessRow[] = [];
  for (const line of stdout.split('\n')) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const pid = Number(m[1]);
    const cmd = m[2].trim();
    if (!pid || !cmd) continue;
    out.push({ pid, cmd });
  }
  return out;
}

export async function listHostProcesses(): Promise<ProcessRow[]> {
  if (process.platform !== 'linux') return [];
  try {
    const { stdout } = await execFileAsync('ps', ['-eo', 'pid=,args='], {
      maxBuffer: 8 * 1024 * 1024,
    });
    return listProcessesFromPs(String(stdout));
  } catch {
    return [];
  }
}

/** PIDs currently in the unit's cgroup (empty if unit inactive / no cgroup). */
export function readUnitCgroupPids(controlGroup: string): Set<number> {
  const owned = new Set<number>();
  const cg = controlGroup.trim();
  if (!cg || cg === '-') return owned;
  // ControlGroup is like "/system.slice/pxo.service"
  const path = cg.startsWith('/sys/fs/cgroup')
    ? cg
    : `/sys/fs/cgroup${cg.startsWith('/') ? '' : '/'}${cg}`;
  const procsFile = `${path.replace(/\/$/, '')}/cgroup.procs`;
  try {
    if (!existsSync(procsFile)) return owned;
    for (const line of readFileSync(procsFile, 'utf8').split('\n')) {
      const n = Number(line.trim());
      if (n > 0) owned.add(n);
    }
  } catch {
    /* */
  }
  return owned;
}

export async function getUnitOwnedPids(unit: string): Promise<Set<number>> {
  const owned = new Set<number>();
  if (process.platform !== 'linux') return owned;
  try {
    const { stdout: cgOut } = await execFileAsync('systemctl', [
      'show',
      '-p',
      'ControlGroup',
      '--value',
      unit,
    ]);
    for (const pid of readUnitCgroupPids(String(cgOut))) owned.add(pid);
  } catch {
    /* */
  }
  try {
    const { stdout: pidOut } = await execFileAsync('systemctl', [
      'show',
      '-p',
      'MainPID',
      '--value',
      unit,
    ]);
    const n = Number(String(pidOut).trim());
    if (n > 0) owned.add(n);
  } catch {
    /* */
  }
  return owned;
}

/**
 * Among host processes matching this unit's app fingerprint, return those
 * not owned by the systemd unit cgroup.
 */
export function findExtraProcesses(
  unit: string,
  processes: ProcessRow[],
  ownedPids: Set<number>,
): ExtraProcess[] {
  if (!hasProcessMatcher(unit)) return [];
  const extras: ExtraProcess[] = [];
  for (const p of processes) {
    if (!cmdlineMatchesUnit(unit, p.cmd)) continue;
    if (ownedPids.has(p.pid)) continue;
    extras.push({ pid: p.pid, cmd: shortCmd(p.cmd) });
  }
  extras.sort((a, b) => a.pid - b.pid);
  return extras;
}
