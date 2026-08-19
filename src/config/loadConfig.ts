/**
 * Load pxh.ini into a typed config object.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { hostname as osHostname } from 'node:os';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import ini from 'ini';
import type { PxhConfig, WarningRule } from '../types.js';
import { DEFAULT_APP_PATHS } from '../types.js';

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

function csv(v: unknown): string[] {
  return str(v)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

export function resolveConfigPath(explicit?: string): string {
  if (explicit && existsSync(explicit)) return explicit;
  for (const p of DEFAULT_CONFIG_PATHS) {
    if (existsSync(p)) return p;
  }
  return explicit || DEFAULT_CONFIG_PATHS[0];
}

function parseWarningRules(raw: Record<string, string>): WarningRule[] {
  const byIndex = new Map<number, { pattern?: string; color?: string }>();
  for (const [k, v] of Object.entries(raw)) {
    const m = /^rule\.(\d+)\.(pattern|color)$/.exec(k);
    if (!m) continue;
    const idx = Number(m[1]);
    const field = m[2] as 'pattern' | 'color';
    const entry = byIndex.get(idx) ?? {};
    entry[field] = String(v).trim();
    byIndex.set(idx, entry);
  }
  return [...byIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, e]) => ({
      pattern: e.pattern || '',
      color: e.color || 'default',
    }))
    .filter((r) => r.pattern);
}

function ensureSessionSecret(
  configured: string,
  configPath: string,
): string {
  if (configured) return configured;
  const stateDir = '/opt/paradox/config';
  const stateFile = resolve(stateDir, '.pxh-session-secret');
  try {
    if (existsSync(stateFile)) {
      const existing = readFileSync(stateFile, 'utf8').trim();
      if (existing.length >= 16) return existing;
    }
  } catch {
    /* fall through */
  }
  const secret = randomBytes(32).toString('hex');
  try {
    if (existsSync(stateDir) || configPath.startsWith('/opt/paradox')) {
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(stateFile, secret, { mode: 0o600 });
    }
  } catch {
    /* ephemeral secret for this process */
  }
  return secret;
}

function parseAppsSection(
  raw: Record<string, string> | undefined,
): Record<string, string> {
  const out: Record<string, string> = { ...DEFAULT_APP_PATHS };
  if (!raw) return out;
  for (const [k, v] of Object.entries(raw)) {
    const name = k.trim();
    if (!name) continue;
    const path = String(v).trim();
    if (!path) {
      delete out[name];
      continue;
    }
    out[name] = path;
  }
  return out;
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
  const svc = raw.services ?? {};
  const appsRaw = raw.apps ?? {};
  const a = raw.actions ?? {};
  const w = raw.warnings ?? {};
  const wc = raw['warnings.colors'] ?? {};
  const j = raw.journal ?? {};
  const p = raw.props ?? {};
  const ui = raw.ui ?? {};
  const pr = raw.prune ?? {};
  const u = raw.ups ?? {};
  const disp = raw.displays ?? {};

  const hostName = osHostname();
  const machineId = str(m.id) || hostName;
  if (!str(m.id)) {
    console.warn(`[pxh] [machine] id empty — using hostname "${machineId}" for MQTT`);
  }

  const scheduleRaw = str(pr.schedule, 'low_disk').toLowerCase();
  const schedule: PxhConfig['prune']['schedule'] =
    scheduleRaw === 'weekly' || scheduleRaw === 'manual_only' || scheduleRaw === 'low_disk'
      ? scheduleRaw
      : 'low_disk';


  const backendRaw = str(u.backend, 'auto').toLowerCase();
  const upsBackend: PxhConfig['ups']['backend'] =
    backendRaw === 'nut' || backendRaw === 'apcupsd' || backendRaw === 'auto'
      ? backendRaw
      : 'auto';

  const themeRaw = str(ui.theme, 'auto').toLowerCase();
  const theme: PxhConfig['ui']['theme'] =
    themeRaw === 'day' || themeRaw === 'night' || themeRaw === 'auto' ? themeRaw : 'auto';

  const sessionSecret = ensureSessionSecret(str(a.session_secret), configPath);

  return {
    server: {
      host: str(s.host, '0.0.0.0'),
      port: num(s.port, 19090),
      serveUi: bool(s.serve_ui, true),
    },
    machine: {
      id: machineId,
      hostname: str(m.hostname) || hostName,
    },
    mqtt: {
      enabled: bool(mq.enabled, true),
      broker: str(mq.broker, 'mqtt://127.0.0.1:1883'),
      topicRoot: str(mq.topic_root, 'paradox'),
      topicBase: str(mq.topic_base),
      publishIntervalSeconds: num(mq.publish_interval_seconds, 30),
      username: str(mq.username),
      password: str(mq.password),
    },
    thresholds: {
      cpuWarnPercent: num(t.cpu_warn_percent, 80),
      cpuCriticalPercent: num(t.cpu_critical_percent, 95),
      tempWarnC: num(t.temp_warn_c, 70),
      tempCriticalC: num(t.temp_critical_c, 80),
      ramWarnPercent: num(t.ram_warn_percent, 80),
      ramCriticalPercent: num(t.ram_critical_percent, 95),
      diskWarnPercent: num(t.disk_warn_percent, 85),
      diskCriticalPercent: num(t.disk_critical_percent, 95),
      diskWarnFreeGb: num(t.disk_warn_free_gb, 0),
      diskCriticalFreeGb: num(t.disk_critical_free_gb, 1),
    },
    services: {
      required: csv(svc.required || 'mosquitto,nginx,pfx,pxo'),
      optional: csv(svc.optional || 'pxh,pxb,pxt,pxc,pfxe,pxio,paradox-speech'),
      user: csv(svc.user),
      scanConflicts: bool(svc.scan_conflicts, true),
    },
    apps: parseAppsSection(appsRaw),
    warnings: {
      enabled: bool(w.enabled, true),
      historyLines: num(w.history_lines, 200),
      historyHours: num(w.history_hours, 24),
      rules: parseWarningRules(w),
      colors: Object.fromEntries(
        Object.entries(wc).map(([k, v]) => [k, String(v).trim()]),
      ),
    },
    journal: {
      enabled: bool(j.enabled, true),
      historyLines: num(j.history_lines, 100),
      historyHours: num(j.history_hours, 6),
      units: csv(j.units),
      colorMode: str(j.color_mode, 'severity'),
    },
    props: {
      enabled: bool(p.enabled, true),
      topics: csv(p.topics || 'paradox/props'),
      historyLines: num(p.history_lines, 50),
      historyHours: num(p.history_hours, 168),
    },
    ui: {
      theme,
      refreshSeconds: num(ui.refresh_seconds, 15),
    },
    actions: {
      enabled: bool(a.enabled, true),
      allowUpgrade: bool(a.allow_upgrade, true),
      allowReboot: bool(a.allow_reboot, true),
      allowService: bool(a.allow_service, true),
      allowCleanup: bool(a.allow_cleanup, true),
      allowPruneIde: bool(a.allow_prune_ide, true),
      allowAppUpdate: bool(a.allow_app_update, true),
      sessionHours: num(a.session_hours, 12),
      allowedUsers: csv(a.allowed_users).map((u) => u.toLowerCase()),
      sessionSecret,
    },
    ups: {
      enabled: bool(u.enabled, true),
      backend: upsBackend,
      nutUps: str(u.nut_ups, 'ups@127.0.0.1'),
      apcupsdHost: str(u.apcupsd_host, '127.0.0.1:3551'),
      batteryWarnPercent: num(u.battery_warn_percent, 50),
      batteryCriticalPercent: num(u.battery_critical_percent, 20),
      runtimeWarnMinutes: num(u.runtime_warn_minutes, 15),
      runtimeCriticalMinutes: num(u.runtime_critical_minutes, 5),
    },
    displays: {
      enabled: bool(disp.enabled, true),
    },
    prune: {
      schedule,
      intervalHours: num(pr.interval_hours, 24),
    },
    configPath,
  };
}

/** Match MQTT topic against + / # wildcards (MQTT-style). */
export function topicMatches(pattern: string, topic: string): boolean {
  const pp = pattern.split('/');
  const tt = topic.split('/');
  for (let i = 0; i < pp.length; i++) {
    if (pp[i] === '#') return true;
    if (i >= tt.length) return false;
    if (pp[i] === '+') continue;
    if (pp[i] !== tt[i]) return false;
  }
  return pp.length === tt.length;
}

export function matchWarningColor(
  topic: string,
  rules: WarningRule[],
): string {
  for (const rule of rules) {
    if (topicMatches(rule.pattern, topic)) return rule.color;
  }
  return 'default';
}
