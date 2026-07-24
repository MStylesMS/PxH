/**
 * Swap usage from /proc/swaps — zram (RAM-backed) vs disk/file swap.
 */

import { readFile } from 'node:fs/promises';
import type { SwapInfo } from '../types.js';

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function kbToMb(kb: number): number {
  return Math.round(kb / 1024);
}

/** Parse /proc/swaps body (header line optional). Exported for tests. */
export function parseProcSwaps(raw: string): SwapInfo | null {
  const lines = raw
    .trim()
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('Filename'));
  if (lines.length === 0) {
    return {
      usedMb: 0,
      totalMb: 0,
      usedPercent: 0,
      zram: null,
      disk: null,
    };
  }

  let zramUsedKb = 0;
  let zramTotalKb = 0;
  let diskUsedKb = 0;
  let diskTotalKb = 0;

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) continue;
    const filename = parts[0];
    const sizeKb = Number(parts[2]);
    const usedKb = Number(parts[3]);
    if (!Number.isFinite(sizeKb) || !Number.isFinite(usedKb)) continue;
    if (filename.includes('zram')) {
      zramTotalKb += sizeKb;
      zramUsedKb += usedKb;
    } else {
      diskTotalKb += sizeKb;
      diskUsedKb += usedKb;
    }
  }

  const totalKb = zramTotalKb + diskTotalKb;
  const usedKb = zramUsedKb + diskUsedKb;
  if (totalKb <= 0) {
    return {
      usedMb: 0,
      totalMb: 0,
      usedPercent: 0,
      zram: null,
      disk: null,
    };
  }

  return {
    usedMb: kbToMb(usedKb),
    totalMb: kbToMb(totalKb),
    usedPercent: round1((usedKb / totalKb) * 100),
    zram:
      zramTotalKb > 0
        ? { usedMb: kbToMb(zramUsedKb), totalMb: kbToMb(zramTotalKb) }
        : null,
    disk:
      diskTotalKb > 0
        ? { usedMb: kbToMb(diskUsedKb), totalMb: kbToMb(diskTotalKb) }
        : null,
  };
}

export async function readSwapInfo(): Promise<SwapInfo | null> {
  if (process.platform !== 'linux') return null;
  try {
    const raw = await readFile('/proc/swaps', 'utf8');
    return parseProcSwaps(raw);
  } catch {
    return null;
  }
}
