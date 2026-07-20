/** Shared types for Paradox Health Monitor. */

export const APP_VERSION = '0.1.0';

export interface DiskRoot {
  totalGb: number;
  usedGb: number;
  availableGb: number;
  usedPercent: number;
}

export type ThresholdLevel = 'ok' | 'warn' | 'critical';

export interface TopConsumer {
  path: string;
  label: string;
  sizeMb: number | null;
}

export interface MetricsSnapshot {
  hostname: string;
  timestamp: string;
  uptimeSeconds: number;
  load: { one: number; five: number; fifteen: number };
  cpuPercent: number;
  cpuTempC: number | null;
  gpuTempC: number | null;
  gpuMemMb: number | null;
  ram: { usedMb: number; totalMb: number; usedPercent: number };
  diskRoot: DiskRoot | null;
  diskLevel: ThresholdLevel;
  aptUpdatesAvailable: number | null;
  sudoNopasswd: boolean | null;
  topConsumers?: TopConsumer[];
}

export type ServiceTier = 'required' | 'optional' | 'user';

export interface RuntimeServiceInfo {
  name: string;
  tier: ServiceTier;
  state: 'running' | 'stopped' | 'failed' | 'unknown';
  pid: number | null;
}

export interface WarningRule {
  pattern: string;
  color: string;
}

export interface PanelLine {
  ts: string;
  topic?: string;
  colorKey?: string;
  severity?: string;
  text: string;
  payload?: unknown;
}

export interface PxhConfig {
  server: {
    host: string;
    port: number;
    serveUi: boolean;
  };
  machine: {
    id: string;
    hostname: string;
  };
  mqtt: {
    enabled: boolean;
    broker: string;
    topicRoot: string;
    topicBase: string;
    publishIntervalSeconds: number;
    username: string;
    password: string;
  };
  thresholds: {
    diskWarnPercent: number;
    diskCriticalPercent: number;
    diskWarnFreeGb: number;
    diskCriticalFreeGb: number;
  };
  services: {
    required: string[];
    optional: string[];
    user: string[];
  };
  warnings: {
    enabled: boolean;
    historyLines: number;
    historyHours: number;
    rules: WarningRule[];
    colors: Record<string, string>;
  };
  journal: {
    enabled: boolean;
    historyLines: number;
    historyHours: number;
    units: string[];
    colorMode: string;
  };
  props: {
    enabled: boolean;
    topics: string[];
    historyLines: number;
    historyHours: number;
  };
  ui: {
    theme: 'day' | 'night' | 'auto';
    refreshSeconds: number;
  };
  actions: {
    enabled: boolean;
    allowUpgrade: boolean;
    allowReboot: boolean;
    allowService: boolean;
    allowCleanup: boolean;
    allowPruneIde: boolean;
    sessionHours: number;
    allowedUsers: string[];
    sessionSecret: string;
  };
  prune: {
    schedule: 'weekly' | 'low_disk' | 'manual_only';
    intervalHours: number;
  };
  configPath: string;
}

/** All unit names with tiers for probing. */
export function allServiceEntries(
  cfg: PxhConfig,
): Array<{ name: string; tier: ServiceTier }> {
  const out: Array<{ name: string; tier: ServiceTier }> = [];
  const seen = new Set<string>();
  for (const [tier, list] of [
    ['required', cfg.services.required],
    ['optional', cfg.services.optional],
    ['user', cfg.services.user],
  ] as const) {
    for (const name of list) {
      if (seen.has(name)) continue;
      seen.add(name);
      out.push({ name, tier });
    }
  }
  return out;
}

/** MQTT publish prefix: topic_base override or topic_root/machine.id */
export function mqttSystemPrefix(cfg: PxhConfig): string {
  if (cfg.mqtt.topicBase) {
    return cfg.mqtt.topicBase.replace(/\/$/, '');
  }
  return `${cfg.mqtt.topicRoot.replace(/\/$/, '')}/${cfg.machine.id}`;
}

export function mqttSystemTopic(cfg: PxhConfig, suffix: string): string {
  return `${mqttSystemPrefix(cfg)}/system/${suffix}`;
}
