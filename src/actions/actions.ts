/**
 * Gated operator actions. Destructive ops require confirm: true + session.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PxhConfig } from '../types.js';
import { allowlistedServiceNames } from '../runtime/services.js';
import { runIdePrune, type PruneResult } from './pruneIde.js';

const execFileAsync = promisify(execFile);

export async function runUpgrade(cfg: PxhConfig): Promise<{ ok: boolean; message: string }> {
  if (!cfg.actions.enabled || !cfg.actions.allowUpgrade) {
    return { ok: false, message: 'Upgrade action disabled in pxh.ini' };
  }
  if (process.platform !== 'linux') {
    return { ok: false, message: 'Upgrade is only supported on Linux' };
  }
  try {
    await execFileAsync('sudo', ['apt-get', 'update'], { timeout: 120_000 });
    await execFileAsync('sudo', ['apt-get', '-y', 'upgrade'], { timeout: 600_000 });
    return { ok: true, message: 'apt update/upgrade completed' };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
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
  action: 'start' | 'stop' | 'restart',
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
): Promise<{ ok: boolean; message: string; dryRun: boolean; planned: string[] }> {
  if (!cfg.actions.enabled || !cfg.actions.allowCleanup) {
    return { ok: false, message: 'Cleanup disabled in pxh.ini', dryRun, planned: [] };
  }
  if (!confirm && !dryRun) {
    return { ok: false, message: 'confirm: true required (or dryRun: true)', dryRun, planned: [] };
  }

  const planned: string[] = [];
  if (targets.includes('apt')) planned.push('sudo apt-get clean');
  if (targets.includes('npm')) planned.push('npm cache clean --force (as paradox user)');
  if (targets.includes('ide')) planned.push('IDE remote-server prune (see /actions/prune-ide)');

  if (dryRun) {
    return { ok: true, message: 'Dry run — no changes', dryRun: true, planned };
  }

  try {
    if (targets.includes('apt') && process.platform === 'linux') {
      await execFileAsync('sudo', ['apt-get', 'clean']);
    }
    if (targets.includes('npm')) {
      await execFileAsync('npm', ['cache', 'clean', '--force'], { timeout: 120_000 });
    }
    if (targets.includes('ide')) {
      const prune = await runIdePrune(false);
      if (!prune.ok) {
        return { ok: false, message: prune.message, dryRun: false, planned };
      }
    }
    return { ok: true, message: 'Cleanup completed', dryRun: false, planned };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
      dryRun: false,
      planned,
    };
  }
}

export async function runPruneIdeAction(
  cfg: PxhConfig,
  confirm: boolean,
  dryRun: boolean,
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
  return runIdePrune(dryRun || !confirm);
}
