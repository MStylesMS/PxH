/**
 * Host metrics — disk root is a first-class field when / is readable.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { hostname as osHostname, loadavg, homedir } from 'node:os';
import { resolve } from 'node:path';
import si from 'systeminformation';
import type { DiskRoot, MetricsSnapshot, PxhConfig, ThresholdLevel, TopConsumer } from '../types.js';
import { getAptUpgradeMetrics } from '../actions/upgradeStatus.js';

const execFileAsync = promisify(execFile);

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * RAM usage from Linux MemAvailable (via systeminformation `available`).
 * Prefer this over `mem.used` (total−free), which inflates % by counting reclaimable cache.
 */
export function ramFromSiMem(mem: {
  total: number;
  available: number;
}): { usedMb: number; totalMb: number; usedPercent: number } {
  const totalMb = Math.round(mem.total / 1024 / 1024);
  const available = Number.isFinite(mem.available) ? mem.available : 0;
  const usedBytes = Math.max(0, mem.total - available);
  const usedPercent = mem.total > 0 ? (usedBytes / mem.total) * 100 : 0;
  return {
    usedMb: Math.round(usedBytes / 1024 / 1024),
    totalMb,
    usedPercent: round1(usedPercent),
  };
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
  } catch {
    /* */
  }
  try {
    const { stdout } = await execFileAsync('vcgencmd', ['measure_temp']);
    const m = stdout.match(/temp=([\d.]+)/);
    if (m) return round1(Number(m[1]));
  } catch {
    /* */
  }
  return null;
}

async function readGpuMemMb(): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('vcgencmd', ['get_mem', 'gpu']);
    const m = stdout.match(/(\d+)M/);
    if (m) return Number(m[1]);
  } catch {
    /* */
  }
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

async function checkSudoNopasswd(): Promise<boolean | null> {
  if (process.platform !== 'linux') return null;
  try {
    await execFileAsync('sudo', ['-n', 'true'], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

async function dirSizeMb(path: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('du', ['-sm', path], { timeout: 30_000 });
    const n = Number(stdout.trim().split(/\s+/)[0]);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export async function readTopConsumers(): Promise<TopConsumer[]> {
  const home = homedir();
  const candidates: Array<{ path: string; label: string }> = [
    { path: resolve(home, '.cursor-server'), label: 'Cursor server' },
    { path: resolve(home, '.vscode-server'), label: 'VS Code server' },
    { path: '/var/cache/apt', label: 'apt cache' },
    { path: resolve(home, '.npm'), label: 'npm cache' },
    { path: '/opt/paradox/logs', label: 'paradox logs' },
  ];
  const out: TopConsumer[] = [];
  for (const c of candidates) {
    const sizeMb = await dirSizeMb(c.path);
    if (sizeMb != null) out.push({ path: c.path, label: c.label, sizeMb });
  }
  return out.sort((a, b) => (b.sizeMb ?? 0) - (a.sizeMb ?? 0));
}

export async function collectMetrics(
  cfg: PxhConfig,
  opts?: { topConsumers?: boolean },
): Promise<MetricsSnapshot> {
  const [load, mem, time, diskRoot, cpuTemp, gpuMem, aptUpdates, sudoNopasswd, aptUpgrade] =
    await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.time(),
      readDiskRoot(),
      readCpuTemp(),
      readGpuMemMb(),
      aptUpdateCount(),
      checkSudoNopasswd(),
      getAptUpgradeMetrics(),
    ]);

  const [one, five, fifteen] = loadavg();

  const snap: MetricsSnapshot = {
    hostname: cfg.machine.hostname || osHostname(),
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(time.uptime),
    load: { one: round1(one), five: round1(five), fifteen: round1(fifteen) },
    cpuPercent: round1(load.currentLoad),
    cpuTempC: cpuTemp,
    gpuTempC: cpuTemp,
    gpuMemMb: gpuMem,
    ram: ramFromSiMem(mem),
    diskRoot,
    diskLevel: diskLevel(diskRoot, cfg.thresholds),
    aptUpdatesAvailable: aptUpdates,
    sudoNopasswd,
  };
  if (aptUpgrade) {
    snap.aptUpgrade = aptUpgrade;
  }

  if (opts?.topConsumers) {
    snap.topConsumers = await readTopConsumers();
  }
  return snap;
}
