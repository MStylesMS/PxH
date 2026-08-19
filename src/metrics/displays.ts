/**
 * HDMI connector metrics from DRM sysfs + EDID.
 * CEC power is cached (slow); collection never waits on cec-client.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import type {
  DisplayCardValue,
  DisplayConnection,
  DisplayInfo,
  DisplayPower,
  PxhConfig,
  ThresholdLevel,
} from '../types.js';

export const CEC_CACHE_TTL_MS = 90_000;

const PNP_VENDOR_HINTS: Record<string, string> = {
  GSM: 'LG',
  SAM: 'Samsung',
  SEC: 'Samsung',
  SNY: 'Sony',
  DEL: 'Dell',
  HPN: 'HP',
  ACR: 'Acer',
  AOC: 'AOC',
  BEN: 'BenQ',
  VSC: 'ViewSonic',
  PHL: 'Philips',
  TSB: 'Toshiba',
  VIZ: 'Vizio',
  SHP: 'Sharp',
  MEI: 'Panasonic',
};

export interface EdidInfo {
  ok: boolean;
  manufacturerId: string | null;
  manufacturerHint: string | null;
  modelName: string | null;
  serialAscii: string | null;
  serialNumeric: number | null;
}

export interface DrmConnector {
  drmName: string;
  port: string;
  status: string;
  enabled: string | null;
  dpms: string | null;
  connected: boolean;
  cecDevice: string | null;
  edid: EdidInfo | null;
}

type CecCacheEntry = { power: DisplayPower; at: number };

let cecCache = new Map<string, CecCacheEntry>();
let cecRefreshing = false;

export function resetDisplayCacheForTests(): void {
  cecCache = new Map();
  cecRefreshing = false;
}

function safeRead(file: string): string | null {
  try {
    return readFileSync(file, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

function descriptorText(buf: Buffer, tag: number): string | null {
  for (let i = 0; i < 4; i += 1) {
    const off = 54 + i * 18;
    if (buf[off] === 0 && buf[off + 1] === 0 && buf[off + 2] === 0 && buf[off + 3] === tag) {
      const text = buf
        .subarray(off + 5, off + 18)
        .toString('ascii')
        .split('\n')[0]
        .replace(/\0/g, '')
        .trim();
      if (text) return text;
    }
  }
  return null;
}

export function parseEdidBuffer(buf: Buffer): EdidInfo {
  if (!buf || buf.length < 128 || buf[0] !== 0x00 || buf[1] !== 0xff) {
    return {
      ok: false,
      manufacturerId: null,
      manufacturerHint: null,
      modelName: null,
      serialAscii: null,
      serialNumeric: null,
    };
  }
  const word = (buf[8] << 8) | buf[9];
  const manufacturerId = String.fromCharCode(
    ((word >> 10) & 0x1f) + 64,
    ((word >> 5) & 0x1f) + 64,
    (word & 0x1f) + 64,
  );
  const serialNumeric = (buf[12] | (buf[13] << 8) | (buf[14] << 16) | (buf[15] << 24)) >>> 0;
  return {
    ok: true,
    manufacturerId,
    manufacturerHint: PNP_VENDOR_HINTS[manufacturerId] || null,
    modelName: descriptorText(buf, 0xfc),
    serialAscii: descriptorText(buf, 0xff),
    serialNumeric,
  };
}

export function parseEdidPath(edidPath: string): EdidInfo | null {
  try {
    const buf = readFileSync(edidPath);
    if (!buf || buf.length < 128) return null;
    return parseEdidBuffer(buf);
  } catch {
    return null;
  }
}

export function parseCecPowerStatus(stdout: string): DisplayPower {
  const m = /power status:\s*(\S+)/i.exec(stdout);
  if (!m) return 'unknown';
  const v = m[1].toLowerCase();
  if (v === 'on') return 'on';
  if (v === 'standby') return 'standby';
  if (v === 'off') return 'off';
  return 'unknown';
}

export function powerFromDpms(dpms: string | null): DisplayPower {
  if (!dpms) return 'unknown';
  const s = dpms.toLowerCase();
  if (s === 'on') return 'on';
  if (s === 'standby' || s === 'suspend') return 'standby';
  if (s === 'off') return 'off';
  return 'unknown';
}

function connectionStatus(status: string): DisplayConnection {
  if (status === 'connected') return 'connected';
  if (status === 'disconnected') return 'disconnected';
  return 'unknown';
}

export function listDrmHdmiConnectors(drmRoot = '/sys/class/drm'): DrmConnector[] {
  if (!existsSync(drmRoot)) return [];
  return readdirSync(drmRoot)
    .filter((name) => /HDMI-A-\d+$/.test(name))
    .map((name) => {
      const dir = join(drmRoot, name);
      const status = safeRead(join(dir, 'status')) || 'unknown';
      const portNum = Number((/HDMI-A-(\d+)$/.exec(name) || [])[1]);
      const port = Number.isFinite(portNum) ? `HDMI-${portNum}` : name;
      const cecPath = Number.isFinite(portNum) ? `/dev/cec${portNum - 1}` : null;
      let cecDevice: string | null = null;
      try {
        if (cecPath && existsSync(cecPath)) cecDevice = cecPath;
      } catch {
        cecDevice = cecPath;
      }
      const connected = status === 'connected';
      return {
        drmName: name,
        port,
        status,
        enabled: safeRead(join(dir, 'enabled')),
        dpms: safeRead(join(dir, 'dpms')),
        connected,
        cecDevice,
        edid: connected ? parseEdidPath(join(dir, 'edid')) : null,
      };
    })
    .sort((a, b) => a.port.localeCompare(b.port, undefined, { numeric: true }));
}

export function classifyDisplay(
  conn: DrmConnector,
  cecPower: DisplayPower | null,
): DisplayInfo {
  const power = cecPower && cecPower !== 'unknown' ? cecPower : powerFromDpms(conn.dpms);
  let value: DisplayCardValue;
  let level: ThresholdLevel;
  if (!conn.connected) {
    value = 'Unplugged';
    level = 'warn';
  } else if (power === 'standby' || power === 'off') {
    value = 'Sleeping';
    level = 'ok';
  } else if (power === 'on') {
    value = 'Awake';
    level = 'ok';
  } else {
    value = 'Connected';
    level = 'ok';
  }
  const make = conn.edid?.manufacturerHint || conn.edid?.manufacturerId || null;
  const model = conn.edid?.modelName || null;
  return {
    port: conn.port,
    drmName: conn.drmName,
    connected: conn.connected,
    status: connectionStatus(conn.status),
    enabled: conn.enabled,
    dpms: conn.dpms,
    power: conn.connected ? power : 'unknown',
    make,
    model,
    serial: conn.edid?.serialAscii || null,
    cecDevice: conn.cecDevice,
    mode: null,
    value,
    level,
  };
}

async function defaultCecPow(cecDevice: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn('cec-client', ['-s', '-d', '1', cecDevice], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      resolve('');
    }, 8000);
    let stdout = '';
    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve('');
    });
    child.on('close', () => {
      clearTimeout(timer);
      resolve(stdout);
    });
    try {
      child.stdin?.write('pow 0\n');
      child.stdin?.end();
    } catch {
      clearTimeout(timer);
      resolve(stdout);
    }
  });
}

async function refreshCecCache(
  connectors: DrmConnector[],
  cecRunner: (device: string) => Promise<string>,
): Promise<void> {
  if (cecRefreshing) return;
  cecRefreshing = true;
  try {
    const now = Date.now();
    for (const conn of connectors) {
      if (!conn.connected || !conn.cecDevice) continue;
      const prev = cecCache.get(conn.cecDevice);
      if (prev && now - prev.at < CEC_CACHE_TTL_MS) continue;
      const stdout = await cecRunner(conn.cecDevice);
      const power = parseCecPowerStatus(stdout);
      if (power !== 'unknown') {
        cecCache.set(conn.cecDevice, { power, at: Date.now() });
      }
    }
  } finally {
    cecRefreshing = false;
  }
}

export interface CollectDisplaysOptions {
  drmRoot?: string;
  cecRunner?: (device: string) => Promise<string>;
  skipCec?: boolean;
  now?: number;
}

export async function collectDisplays(
  cfg: PxhConfig,
  opts: CollectDisplaysOptions = {},
): Promise<DisplayInfo[]> {
  if (!cfg.displays?.enabled) return [];
  const drmRoot = opts.drmRoot || '/sys/class/drm';
  const connectors = listDrmHdmiConnectors(drmRoot);
  const now = opts.now ?? Date.now();
  const out = connectors.map((conn) => {
    const cached =
      conn.cecDevice && cecCache.has(conn.cecDevice) ? cecCache.get(conn.cecDevice) : undefined;
    const cecPower =
      cached && now - cached.at < CEC_CACHE_TTL_MS * 2 ? cached.power : null;
    return classifyDisplay(conn, cecPower ?? null);
  });

  if (!opts.skipCec) {
    const runner = opts.cecRunner || defaultCecPow;
    void refreshCecCache(connectors, runner);
  }
  return out;
}
