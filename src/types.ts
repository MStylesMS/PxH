/** Shared types for Paradox Health Monitor. */

export const APP_VERSION = '0.1.0';

export interface DiskRoot {
  totalGb: number;
  usedGb: number;
  availableGb: number;
  usedPercent: number;
}

export type ThresholdLevel = 'ok' | 'warn' | 'critical';

export type UpsStatus =
  | 'online'
  | 'on_battery'
  | 'low_battery'
  | 'charging'
  | 'replace_battery'
  | 'no_comms'
  | 'none';

export interface UpsInfo {
  present: boolean;
  backend: 'nut' | 'apcupsd' | null;
  name: string | null;
  model: string | null;
  mfr: string | null;
  status: UpsStatus;
  statusRaw: string | null;
  batteryChargePercent: number | null;
  runtimeSeconds: number | null;
  runtimeMinutes: number | null;
  loadPercent: number | null;
  /** Instantaneous watts when known (`ups.realpower`, or load% × nominal). */
  realPowerWatts: number | null;
  /** Nameplate watts (`ups.realpower.nominal`) when reported. */
  realPowerNominalWatts: number | null;
  inputVoltage: number | null;
  batteryVoltage: number | null;
  level: ThresholdLevel;
}

export interface TopConsumer {
  path: string;
  label: string;
  sizeMb: number | null;
}

/** Detached OS-upgrade progress (from /run/pxh/upgrade-status.json). */
export interface AptUpgradeMetrics {
  inProgress: boolean;
  phase: string;
  message: string;
  completed: number;
  total: number;
  startedAt: string | null;
  finishedAt: string | null;
  ok: boolean | null;
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
  /**
   * RAM from MemAvailable: usedMb = total − available (reclaimable cache not counted as used).
   * usedPercent = usedMb / totalMb.
   */
  ram: { usedMb: number; totalMb: number; usedPercent: number };
  diskRoot: DiskRoot | null;
  diskLevel: ThresholdLevel;
  aptUpdatesAvailable: number | null;
  /** Present when an upgrade status file exists (in progress or last result). */
  aptUpgrade?: AptUpgradeMetrics;
  sudoNopasswd: boolean | null;
  ups: UpsInfo;
  topConsumers?: TopConsumer[];
}

export type ServiceTier = 'required' | 'optional' | 'user';

export interface ExtraProcess {
  pid: number;
  /** Truncated cmdline for UI */
  cmd: string;
}

export interface RuntimeServiceInfo {
  name: string;
  tier: ServiceTier;
  state: 'running' | 'stopped' | 'failed' | 'unknown';
  /** systemd unit enabled at boot: enabled | disabled | static | masked | unknown */
  enabled: 'enabled' | 'disabled' | 'static' | 'masked' | 'unknown';
  pid: number | null;
  /**
   * App processes matching this unit's fingerprint that are not in the unit
   * cgroup (lab/dev copies, orphans). Empty when none or scanning disabled.
   */
  extraProcesses: ExtraProcess[];
}

/** Git commit summary for Paradox app version inventory (Phase 1). */
export interface AppCommitInfo {
  sha: string;
  short: string;
  subject: string;
  body: string;
  author: string;
  /** Committer date (ISO-8601 from git %cI) */
  date: string;
}

/** Per-unit git identity from `[apps]` map + origin compare. */
export interface AppVersionInfo {
  name: string;
  path: string;
  present: boolean;
  git: boolean;
  /** Current branch, or null if detached HEAD */
  branch: string | null;
  head: AppCommitInfo | null;
  remote: string;
  /** `git remote get-url origin`, when available */
  originUrl: string | null;
  /** Branch names on origin (without origin/ prefix) */
  originBranches: string[];
  /** Commits on origin/<branch> not in HEAD; null if unknown */
  behind: number | null;
  /** Local commits not on origin/<branch>; null if unknown */
  ahead: number | null;
  /** Newer commits on origin/<current-branch> (newest first), capped */
  newerCommits: AppCommitInfo[];
  fetchedAt: string | null;
  error: string | null;
}

/** Branch commit list for the update modal (`GET /apps/:name/commits`). */
export interface AppBranchCommits {
  name: string;
  path: string;
  branch: string;
  originUrl: string | null;
  /** Current checkout branch, or null if detached */
  currentBranch: string | null;
  headSha: string | null;
  head: AppCommitInfo | null;
  /** Commits on origin/<branch> not in HEAD (when comparing current checkout) */
  behind: number | null;
  /** Recent commits on origin/<branch>, newest first */
  commits: AppCommitInfo[];
  fetchedAt: string | null;
  error: string | null;
}

/** Select-list entries for the update modal commit dropdown. */
export type CommitSelectOption =
  | { kind: 'commit'; commit: AppCommitInfo; current: boolean }
  | { kind: 'gap'; more: number };

/** Default unit → checkout path conventions (overridden by [apps] in pxh.ini). */
export const DEFAULT_APP_PATHS: Record<string, string> = {
  'paradox-health': '/opt/paradox/apps/PxH',
  pfx: '/opt/paradox/apps/PFx',
  pfxe: '/opt/paradox/apps/PFxE',
  pxo: '/opt/paradox/apps/PxO',
  pio: '/opt/paradox/apps/PiO',
  pxb: '/opt/paradox/apps/PxB',
  pxt: '/opt/paradox/apps/PxT',
  pxc: '/opt/paradox/apps/PxC',
};

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
    /** Scan for unmanaged matching processes (default true). */
    scanConflicts: boolean;
  };
  /** systemd unit name → absolute path to Paradox app git checkout */
  apps: Record<string, string>;
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
    allowAppUpdate: boolean;
    sessionHours: number;
    allowedUsers: string[];
    sessionSecret: string;
  };
  ups: {
    enabled: boolean;
    backend: 'nut' | 'apcupsd' | 'auto';
    nutUps: string;
    apcupsdHost: string;
    batteryWarnPercent: number;
    batteryCriticalPercent: number;
    runtimeWarnMinutes: number;
    runtimeCriticalMinutes: number;
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
