/** Shared types for Paradox Health Monitor. */

export const APP_VERSION = '0.1.0';

export interface DiskRoot {
  totalGb: number;
  usedGb: number;
  availableGb: number;
  usedPercent: number;
}

export type ThresholdLevel = 'ok' | 'warn' | 'critical';

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
}

export interface RuntimeServiceInfo {
  name: string;
  state: 'running' | 'stopped' | 'failed' | 'unknown';
  pid: number | null;
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
  runtime: {
    services: string[];
  };
  actions: {
    enabled: boolean;
    allowUpgrade: boolean;
    allowReboot: boolean;
    allowService: boolean;
    allowCleanup: boolean;
    allowPruneIde: boolean;
  };
  configPath: string;
}
