/**
 * UPS metrics via NUT (upsc) with optional apcaccess fallback.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PxhConfig, ThresholdLevel, UpsInfo, UpsStatus } from '../types.js';

const execFileAsync = promisify(execFile);

export function parseUpscOutput(stdout: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of stdout.split('\n')) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key) out[key] = val;
  }
  return out;
}

function parseNum(v: string | undefined): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function mapUpsStatus(statusRaw: string | null): UpsStatus {
  if (!statusRaw) return 'no_comms';
  const tokens = statusRaw.toUpperCase().split(/\s+/);
  if (tokens.includes('LB')) return 'low_battery';
  if (tokens.includes('OB')) return 'on_battery';
  if (tokens.includes('RB')) return 'replace_battery';
  if (tokens.includes('CHRG') && !tokens.includes('OB')) return 'charging';
  if (tokens.includes('OL')) return 'online';
  return 'no_comms';
}

export function upsLevel(
  info: Pick<UpsInfo, 'status' | 'batteryChargePercent' | 'runtimeMinutes'>,
  cfg: PxhConfig['ups'],
): ThresholdLevel {
  const { status, batteryChargePercent: charge, runtimeMinutes: runtime } = info;
  if (status === 'none' || status === 'online' || status === 'charging') return 'ok';
  if (status === 'low_battery') return 'critical';
  if (status === 'replace_battery') return 'warn';
  if (status === 'no_comms') return cfg.enabled ? 'warn' : 'ok';

  if (status === 'on_battery') {
    if (charge != null && charge <= cfg.batteryCriticalPercent) return 'critical';
    if (runtime != null && runtime <= cfg.runtimeCriticalMinutes) return 'critical';
    if (charge != null && charge <= cfg.batteryWarnPercent) return 'warn';
    if (runtime != null && runtime <= cfg.runtimeWarnMinutes) return 'warn';
    return 'warn';
  }
  return 'ok';
}

export function buildUpsInfoFromVars(
  vars: Record<string, string>,
  backend: 'nut' | 'apcupsd',
  cfg: PxhConfig['ups'],
): UpsInfo {
  const statusRaw = vars['ups.status'] ?? null;
  const runtimeSeconds = parseNum(vars['battery.runtime'] ?? vars['TIMELEFT']);
  const runtimeMinutes =
    runtimeSeconds != null ? Math.round(runtimeSeconds / 60) : null;
  const status = mapUpsStatus(statusRaw);
  const info: UpsInfo = {
    present: true,
    backend,
    name: vars['ups.name'] ?? null,
    model: vars['device.model'] ?? vars['ups.model'] ?? vars['MODEL'] ?? null,
    mfr: vars['device.mfr'] ?? vars['ups.mfr'] ?? null,
    status,
    statusRaw,
    batteryChargePercent: parseNum(vars['battery.charge'] ?? vars['BCHARGE']),
    runtimeSeconds,
    runtimeMinutes,
    loadPercent: parseNum(vars['ups.load'] ?? vars['LOADPCT']),
    inputVoltage: parseNum(vars['input.voltage'] ?? vars['LINEV']),
    batteryVoltage: parseNum(vars['battery.voltage'] ?? vars['BATTV']),
    level: 'ok',
  };
  info.level = upsLevel(info, cfg);
  return info;
}

export function absentUps(): UpsInfo {
  return {
    present: false,
    backend: null,
    name: null,
    model: null,
    mfr: null,
    status: 'none',
    statusRaw: null,
    batteryChargePercent: null,
    runtimeSeconds: null,
    runtimeMinutes: null,
    loadPercent: null,
    inputVoltage: null,
    batteryVoltage: null,
    level: 'ok',
  };
}

async function listNutUps(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('upsc', ['-l'], { timeout: 5_000 });
    const first = stdout
      .trim()
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)[0];
    return first ?? null;
  } catch {
    return null;
  }
}

async function readNutUps(upsId: string): Promise<Record<string, string> | null> {
  try {
    const { stdout } = await execFileAsync('upsc', [upsId], { timeout: 5_000 });
    return parseUpscOutput(stdout);
  } catch {
    return null;
  }
}

function parseApcaccessOutput(stdout: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of stdout.split('\n')) {
    const parts = line.split(':');
    if (parts.length < 2) continue;
    const key = parts[0].trim();
    const val = parts.slice(1).join(':').trim();
    if (key) out[key] = val;
  }
  return out;
}

async function readApcupsd(hostPort: string): Promise<Record<string, string> | null> {
  const [host, portRaw] = hostPort.includes(':') ? hostPort.split(':', 2) : [hostPort, '3551'];
  try {
    const { stdout } = await execFileAsync('apcaccess', ['status', host, portRaw], {
      timeout: 5_000,
    });
    const raw = parseApcaccessOutput(stdout);
    const status = raw['STATUS'] ?? '';
    const mapped: Record<string, string> = {
      'ups.status': status.includes('ONLINE') ? 'OL' : status.includes('ONBATT') ? 'OB' : status,
      'battery.charge': raw['BCHARGE']?.replace(/\s*%/, '') ?? '',
      'battery.runtime': raw['TIMELEFT']
        ? String(Number(raw['TIMELEFT'].replace(/\s*Seconds/, '')) || 0)
        : '',
      'ups.load': raw['LOADPCT']?.replace(/\s*Percent/, '') ?? '',
      'input.voltage': raw['LINEV'] ?? '',
      'battery.voltage': raw['BATTV'] ?? '',
      MODEL: raw['MODEL'] ?? '',
    };
    return mapped;
  } catch {
    return null;
  }
}

export async function collectUps(cfg: PxhConfig): Promise<UpsInfo> {
  if (!cfg.ups.enabled) return absentUps();

  const backend = cfg.ups.backend;
  const tryNut = backend === 'nut' || backend === 'auto';
  const tryApc = backend === 'apcupsd' || backend === 'auto';

  if (tryNut) {
    let upsId = cfg.ups.nutUps.trim();
    if (!upsId) upsId = (await listNutUps()) ?? '';
    if (upsId) {
      const vars = await readNutUps(upsId);
      if (vars) return buildUpsInfoFromVars(vars, 'nut', cfg.ups);
    }
  }

  if (tryApc) {
    const vars = await readApcupsd(cfg.ups.apcupsdHost);
    if (vars) return buildUpsInfoFromVars(vars, 'apcupsd', cfg.ups);
  }

  const missing = absentUps();
  missing.status = 'no_comms';
  return missing;
}
