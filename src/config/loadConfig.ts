/**
 * Load pxh.ini into a typed config object.
 */

import { readFileSync, existsSync } from 'node:fs';
import { hostname as osHostname } from 'node:os';
import { resolve } from 'node:path';
import ini from 'ini';
import type { PxhConfig } from '../types.js';

export const DEFAULT_CONFIG_PATHS = [
  '/opt/paradox/config/pxh.ini',
  resolve(process.cwd(), 'pxh.ini'),
  resolve(process.cwd(), 'config/pxh.ini'),
];

function bool(v: unknown, fallback: boolean): boolean {
  if (v === undefined || v === null || v === '') return fallback;
  const s = String(v).toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'off'].includes(s)) return false;
  return fallback;
}

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function str(v: unknown, fallback = ''): string {
  return v === undefined || v === null ? fallback : String(v).trim();
}

export function resolveConfigPath(explicit?: string): string {
  if (explicit && existsSync(explicit)) return explicit;
  for (const p of DEFAULT_CONFIG_PATHS) {
    if (existsSync(p)) return p;
  }
  return explicit || DEFAULT_CONFIG_PATHS[0];
}

export function loadConfig(configPath: string): PxhConfig {
  let raw: Record<string, Record<string, string>> = {};
  if (existsSync(configPath)) {
    raw = ini.parse(readFileSync(configPath, 'utf8')) as typeof raw;
  } else {
    console.warn(`[pxh] Config not found at ${configPath} — using defaults`);
  }

  const s = raw.server ?? {};
  const m = raw.machine ?? {};
  const mq = raw.mqtt ?? {};
  const t = raw.thresholds ?? {};
  const r = raw.runtime ?? {};
  const a = raw.actions ?? {};

  const machineId = str(m.id) || osHostname();

  return {
    server: {
      host: str(s.host, '127.0.0.1'),
      port: num(s.port, 19090),
      serveUi: bool(s.serve_ui, true),
    },
    machine: {
      id: machineId,
      hostname: str(m.hostname) || osHostname(),
    },
    mqtt: {
      enabled: bool(mq.enabled, false),
      broker: str(mq.broker, 'mqtt://127.0.0.1:1883'),
      topicBase: str(mq.topic_base) || `paradox/${machineId}`,
      publishIntervalSeconds: num(mq.publish_interval_seconds, 30),
      username: str(mq.username),
      password: str(mq.password),
    },
    thresholds: {
      diskWarnPercent: num(t.disk_warn_percent, 85),
      diskCriticalPercent: num(t.disk_critical_percent, 95),
      diskWarnFreeGb: num(t.disk_warn_free_gb, 0),
      diskCriticalFreeGb: num(t.disk_critical_free_gb, 1),
    },
    runtime: {
      services: str(r.services, 'mosquitto,pfx,pxo,pxb,pxt,pxc')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    },
    actions: {
      enabled: bool(a.enabled, true),
      allowUpgrade: bool(a.allow_upgrade, true),
      allowReboot: bool(a.allow_reboot, true),
      allowService: bool(a.allow_service, true),
      allowCleanup: bool(a.allow_cleanup, true),
      allowPruneIde: bool(a.allow_prune_ide, true),
    },
    configPath,
  };
}
