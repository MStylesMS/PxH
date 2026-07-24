/**
 * Cached apt upgradable count — refreshed at startup and daily at 03:00 local.
 * Avoids running `apt list --upgradable` on every metrics poll.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

let cachedCount: number | null = null;
let refreshing = false;
let dailyTimer: ReturnType<typeof setTimeout> | null = null;

async function queryAptUpdateCount(): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('bash', [
      '-c',
      "apt list --upgradable 2>/dev/null | grep -v '^Listing' | grep '/' | wc -l",
    ]);
    const n = Number(stdout.trim());
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** Returns the last cached count (null until the first refresh completes). */
export function getCachedAptUpdateCount(): number | null {
  return cachedCount;
}

/** Force a refresh (startup, daily schedule, or tests). */
export async function refreshAptUpdateCount(reason = 'manual'): Promise<number | null> {
  if (refreshing) return cachedCount;
  refreshing = true;
  try {
    cachedCount = await queryAptUpdateCount();
    console.log(`[pxh] apt upgradable count refreshed (${reason}): ${cachedCount ?? 'n/a'}`);
    return cachedCount;
  } finally {
    refreshing = false;
  }
}

/** Milliseconds until the next occurrence of `hour` (0–23) in local time. */
export function msUntilNextLocalHour(hour: number, now = new Date()): number {
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}

function scheduleDailyRefresh(): void {
  if (dailyTimer) clearTimeout(dailyTimer);
  const delay = msUntilNextLocalHour(3);
  dailyTimer = setTimeout(() => {
    void refreshAptUpdateCount('daily-03:00').finally(scheduleDailyRefresh);
  }, delay);
}

/** Refresh once at startup, then daily at 03:00 local. */
export function startAptUpdateCache(): void {
  void refreshAptUpdateCount('startup');
  scheduleDailyRefresh();
}

export function stopAptUpdateCache(): void {
  if (dailyTimer) {
    clearTimeout(dailyTimer);
    dailyTimer = null;
  }
}
