/** Journal panel collector via journalctl. */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PanelLine, PxhConfig } from '../types.js';
import { allServiceEntries } from '../types.js';
import type { RingBuffer } from '../panels/ringBuffer.js';

const execFileAsync = promisify(execFile);

function severityFromPriority(prio: string | number | undefined): string {
  const n = typeof prio === 'string' ? Number(prio) : prio;
  if (n == null || !Number.isFinite(n)) return 'info';
  if (n <= 3) return 'err';
  if (n === 4) return 'warning';
  if (n === 5) return 'notice';
  if (n === 6) return 'info';
  return 'debug';
}

export async function pollJournal(
  cfg: PxhConfig,
  buffer: RingBuffer,
): Promise<void> {
  if (!cfg.journal.enabled || process.platform !== 'linux') return;

  const units =
    cfg.journal.units.length > 0
      ? cfg.journal.units
      : allServiceEntries(cfg).map((e) => e.name);
  if (units.length === 0) return;

  const args = ['-o', 'json', '-n', String(Math.min(50, cfg.journal.historyLines)), '--no-pager'];
  for (const u of units) {
    args.push('-u', u.endsWith('.service') ? u : `${u}.service`);
  }

  try {
    const { stdout } = await execFileAsync('journalctl', args, {
      timeout: 15_000,
      maxBuffer: 2_000_000,
    });
    const seen = new Set(buffer.list().map((l) => `${l.ts}|${l.text}`));
    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line) as {
          __REALTIME_TIMESTAMP?: string;
          MESSAGE?: string;
          PRIORITY?: string;
          _SYSTEMD_UNIT?: string;
        };
        const us = Number(row.__REALTIME_TIMESTAMP);
        const ts = Number.isFinite(us)
          ? new Date(us / 1000).toISOString()
          : new Date().toISOString();
        const text = String(row.MESSAGE ?? '').trim();
        if (!text) continue;
        const key = `${ts}|${text}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const entry: PanelLine = {
          ts,
          topic: row._SYSTEMD_UNIT,
          severity: severityFromPriority(row.PRIORITY),
          text,
        };
        buffer.push(entry);
      } catch {
        /* skip bad line */
      }
    }
  } catch {
    /* journalctl unavailable */
  }
}
