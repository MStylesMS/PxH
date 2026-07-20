/**
 * Gated operator actions. Destructive ops require confirm: true + session.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PxhConfig } from '../types.js';
import { allowlistedServiceNames } from '../runtime/services.js';
import { runIdePrune, type PruneResult } from './pruneIde.js';

const execFileAsync = promisify(execFile);

export type ServiceAction = 'start' | 'stop' | 'restart' | 'enable' | 'disable';

export async function runUpgrade(
  cfg: PxhConfig,
  onProgress?: (step: string) => void,
): Promise<{ ok: boolean; message: string; steps?: string[] }> {
  if (!cfg.actions.enabled || !cfg.actions.allowUpgrade) {
    return { ok: false, message: 'Upgrade action disabled in pxh.ini' };
  }
  if (process.platform !== 'linux') {
    return { ok: false, message: 'Upgrade is only supported on Linux' };
  }
  const steps: string[] = [];
  try {
    onProgress?.('Running apt-get update…');
    steps.push('apt-get update');
    await execFileAsync('sudo', ['apt-get', 'update'], { timeout: 120_000 });
    onProgress?.('Running apt-get -y upgrade… (may take several minutes)');
    steps.push('apt-get -y upgrade');
    await execFileAsync('sudo', ['apt-get', '-y', 'upgrade'], { timeout: 600_000 });
    return {
      ok: true,
      message: 'Upgrade finished: apt update + upgrade completed',
      steps,
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
      steps,
    };
  }
}

export async function runReboot(
  cfg: PxhConfig,
  confirm: boolean,
): Promise<{ ok: boolean; message: string }> {
  if (!cfg.actions.enabled || !cfg.actions.allowReboot) {
    return { ok: false, message: 'Reboot action disabled in pxh.ini' };
  }
  if (!confirm) return { ok: false, message: 'confirm: true required' };
  if (process.platform !== 'linux') {
    return { ok: false, message: 'Reboot is only supported on Linux' };
  }
  try {
    void execFileAsync('sudo', ['shutdown', '-r', '+1', 'PxH requested reboot']);
    return { ok: true, message: 'Reboot scheduled in ~1 minute' };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function runServiceAction(
  cfg: PxhConfig,
  name: string,
  action: ServiceAction,
): Promise<{ ok: boolean; message: string }> {
  if (!cfg.actions.enabled || !cfg.actions.allowService) {
    return { ok: false, message: 'Service action disabled in pxh.ini' };
  }
  if (!allowlistedServiceNames(cfg).includes(name)) {
    return { ok: false, message: `Service ${name} is not allowlisted in pxh.ini` };
  }
  if (process.platform !== 'linux') {
    return { ok: false, message: 'Service control is only supported on Linux' };
  }
  // Do not let operators kill the health UI out from under themselves
  if (
    (name === 'paradox-health' || name === 'paradox-health.service') &&
    (action === 'stop' || action === 'disable')
  ) {
    return {
      ok: false,
      message: `Refusing to ${action} paradox-health (would take down this UI). Use restart instead.`,
    };
  }
  try {
    await execFileAsync('sudo', ['systemctl', action, name]);
    return { ok: true, message: `${action} ${name} ok` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function runCleanup(
  cfg: PxhConfig,
  targets: string[],
  confirm: boolean,
  dryRun: boolean,
  onProgress?: (step: string) => void,
): Promise<{
  ok: boolean;
  message: string;
  dryRun: boolean;
  planned: string[];
  done: string[];
}> {
  if (!cfg.actions.enabled || !cfg.actions.allowCleanup) {
    return { ok: false, message: 'Cleanup disabled in pxh.ini', dryRun, planned: [], done: [] };
  }
  if (!confirm && !dryRun) {
    return {
      ok: false,
      message: 'confirm: true required (or dryRun: true)',
      dryRun,
      planned: [],
      done: [],
    };
  }

  const planned: string[] = [];
  if (targets.includes('apt')) planned.push('apt-get clean (clear downloaded package archives)');
  if (targets.includes('npm')) planned.push('npm cache clean --force');
  if (targets.includes('ide')) planned.push('IDE remote-server prune');

  if (dryRun) {
    return {
      ok: true,
      message: `Cleanup dry-run — would run: ${planned.join('; ') || '(nothing)'}`,
      dryRun: true,
      planned,
      done: [],
    };
  }

  const done: string[] = [];
  try {
    if (targets.includes('apt') && process.platform === 'linux') {
      onProgress?.('Cleaning apt package cache (apt-get clean)…');
      await execFileAsync('sudo', ['apt-get', 'clean']);
      done.push('apt-get clean');
    }
    if (targets.includes('npm')) {
      onProgress?.('Cleaning npm cache…');
      await execFileAsync('npm', ['cache', 'clean', '--force'], { timeout: 120_000 });
      done.push('npm cache clean');
    }
    if (targets.includes('ide')) {
      onProgress?.('Pruning IDE remote-server builds…');
      const prune = await runIdePrune(false);
      if (!prune.ok) {
        return { ok: false, message: prune.message, dryRun: false, planned, done };
      }
      done.push(`ide prune (${Math.round(prune.bytesReclaimed / 1e6)} MB)`);
    }
    return {
      ok: true,
      message: `Cleanup finished: ${done.join(', ') || 'nothing to do'}`,
      dryRun: false,
      planned,
      done,
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
      dryRun: false,
      planned,
      done,
    };
  }
}

export async function runPruneIdeAction(
  cfg: PxhConfig,
  confirm: boolean,
  dryRun: boolean,
  onProgress?: (step: string) => void,
): Promise<PruneResult> {
  if (!cfg.actions.enabled || !cfg.actions.allowPruneIde) {
    return {
      ok: false,
      message: 'IDE prune disabled in pxh.ini',
      dryRun,
      kept: [],
      deleted: [],
      bytesReclaimed: 0,
    };
  }
  if (!confirm && !dryRun) {
    return {
      ok: false,
      message: 'confirm: true required (or dryRun: true)',
      dryRun,
      kept: [],
      deleted: [],
      bytesReclaimed: 0,
    };
  }
  onProgress?.(dryRun || !confirm ? 'Scanning IDE builds (dry-run)…' : 'Deleting stale IDE builds…');
  return runIdePrune(dryRun || !confirm);
}
