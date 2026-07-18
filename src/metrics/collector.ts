/**
 * Host metrics — disk root is a first-class field when / is readable (never silent null on Pi).
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { hostname as osHostname, loadavg } from 'node:os';
import si from 'systeminformation';
import type { DiskRoot, MetricsSnapshot, PxhConfig, ThresholdLevel } from '../types.js';

const execFileAsync = promisify(execFile);

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function diskLevel(disk: DiskRoot | null, cfg: PxhConfig['thresholds']): ThresholdLevel {
  if (!disk) return 'ok';
  if (
    disk.usedPercent >= cfg.diskCriticalPercent ||
    (cfg.diskCriticalFreeGb > 0 && disk.availableGb <= cfg.diskCriticalFreeGb)
  ) {
    return 'critical';
  }
  if (
    disk.usedPercent >= cfg.diskWarnPercent ||
    (cfg.diskWarnFreeGb > 0 && disk.availableGb <= cfg.diskWarnFreeGb)
  ) {
    return 'warn';
  }
  return 'ok';
}

/** Read root filesystem via systeminformation, with df fallback. */
export async function readDiskRoot(): Promise<DiskRoot | null> {
  try {
    const disks = await si.fsSize();
    const root = disks.find((d) => d.mount === '/') ?? disks[0];
    if (root && root.size > 0) {
      return {
        totalGb: round1(root.size / 1e9),
        usedGb: round1(root.used / 1e9),
        availableGb: round1(root.available / 1e9),
        usedPercent: round1((root.used / root.size) * 100),
      };
    }
  } catch {
    /* fall through */
  }

  try {
    const { stdout } = await execFileAsync('df', ['-B1', '--output=size,used,avail,pcent', '/']);
    const lines = stdout.trim().split('\n');
    const parts = lines[lines.length - 1]?.trim().split(/\s+/);
    if (!parts || parts.length < 4) return null;
    const size = Number(parts[0]);
    const used = Number(parts[1]);
    const avail = Number(parts[2]);
    const pct = Number(String(parts[3]).replace('%', ''));
    if (!Number.isFinite(size) || size <= 0) return null;
    return {
      totalGb: round1(size / 1e9),
      usedGb: round1(used / 1e9),
      availableGb: round1(avail / 1e9),
      usedPercent: round1(pct),
    };
  } catch {
    return null;
  }
}

async function readCpuTemp(): Promise<number | null> {
  try {
    const t = await si.cpuTemperature();
    if (t.main != null && Number.isFinite(t.main)) return round1(t.main);
  } catch { /* */ }
  try {
    const { stdout } = await execFileAsync('vcgencmd', ['measure_temp']);
    const m = stdout.match(/temp=([\d.]+)/);
    if (m) return round1(Number(m[1]));
  } catch { /* */ }
  return null;
}

async function readGpuMemMb(): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('vcgencmd', ['get_mem', 'gpu']);
    const m = stdout.match(/(\d+)M/);
    if (m) return Number(m[1]);
  } catch { /* */ }
  return null;
}

async function aptUpdateCount(): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('bash', [
      '-c',
      "apt list --upgradable 2>/dev/null | grep -v '^Listing' | grep '/' | wc -l",
    ]);
    const n = Number(stdout.trim());
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export async function collectMetrics(cfg: PxhConfig): Promise<MetricsSnapshot> {
  const [load, mem, time, diskRoot, cpuTemp, gpuMem, aptUpdates] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.time(),
    readDiskRoot(),
    readCpuTemp(),
    readGpuMemMb(),
    aptUpdateCount(),
  ]);

  const [one, five, fifteen] = loadavg();
  const usedPercent = mem.total > 0 ? (mem.used / mem.total) * 100 : 0;

  return {
    hostname: cfg.machine.hostname || osHostname(),
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(time.uptime),
    load: { one: round1(one), five: round1(five), fifteen: round1(fifteen) },
    cpuPercent: round1(load.currentLoad),
    cpuTempC: cpuTemp,
    gpuTempC: cpuTemp,
    gpuMemMb: gpuMem,
    ram: {
      usedMb: Math.round(mem.used / 1024 / 1024),
      totalMb: Math.round(mem.total / 1024 / 1024),
      usedPercent: round1(usedPercent),
    },
    diskRoot,
    diskLevel: diskLevel(diskRoot, cfg.thresholds),
    aptUpdatesAvailable: aptUpdates,
    sudoNopasswd: null,
  };
}
