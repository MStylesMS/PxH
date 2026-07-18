/**
 * Gated operator actions. Dangerous ops require confirm: true.
 * IDE prune / cleanup are stubbed with dry-run-friendly shapes for review.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PxhConfig } from '../types.js';

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

export async function runReboot(cfg: PxhConfig, confirm: boolean): Promise<{ ok: boolean; message: string }> {
  if (!cfg.actions.enabled || !cfg.actions.allowReboot) {
    return { ok: false, message: 'Reboot action disabled in pxh.ini' };
  }
  if (!confirm) return { ok: false, message: 'confirm: true required' };
  if (process.platform !== 'linux') {
    return { ok: false, message: 'Reboot is only supported on Linux' };
  }
  try {
    // Delay so HTTP response can return
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
  if (!cfg.runtime.services.includes(name)) {
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

  // MVP scaffold: execute apt clean only; npm/ide via dedicated endpoints
  try {
    if (targets.includes('apt') && process.platform === 'linux') {
      await execFileAsync('sudo', ['apt-get', 'clean']);
    }
    return { ok: true, message: 'Cleanup completed (partial — see planned list)', dryRun: false, planned };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
      dryRun: false,
      planned,
    };
  }
}

/**
 * IDE prune — scaffold returns dry-run inventory only until rules in SPEC §7.2 are fully wired.
 */
export async function runPruneIde(
  cfg: PxhConfig,
  confirm: boolean,
  dryRun: boolean,
): Promise<{
  ok: boolean;
  message: string;
  dryRun: boolean;
  kept: string[];
  deleted: string[];
  bytesReclaimed: number;
}> {
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

  // Scaffold: do not delete yet — report that implementation follows SPEC §7.2
  return {
    ok: true,
    message:
      dryRun || !confirm
        ? 'Dry-run scaffold: scan/delete not yet implemented — see docs/SPEC.md §7.2'
        : 'Prune execute path not yet implemented — refusing to delete (safe scaffold)',
    dryRun: true,
    kept: [],
    deleted: [],
    bytesReclaimed: 0,
  };
}
