/** Ring buffer with line count + age eviction. */

import type { PanelLine } from '../types.js';

export class RingBuffer {
  private items: PanelLine[] = [];

  constructor(
    private readonly maxLines: number,
    private readonly maxHours: number,
  ) {}

  push(line: PanelLine): void {
    this.items.push(line);
    this.evict();
  }

  list(opts?: { lines?: number; since?: string }): PanelLine[] {
    this.evict();
    let out = this.items;
    if (opts?.since) {
      const sinceMs = Date.parse(opts.since);
      if (Number.isFinite(sinceMs)) {
        out = out.filter((l) => Date.parse(l.ts) >= sinceMs);
      }
    }
    if (opts?.lines != null && opts.lines > 0) {
      out = out.slice(-opts.lines);
    }
    return out;
  }

  private evict(): void {
    const cutoff = Date.now() - this.maxHours * 3600_000;
    this.items = this.items.filter((l) => {
      const t = Date.parse(l.ts);
      return !Number.isFinite(t) || t >= cutoff;
    });
    if (this.items.length > this.maxLines) {
      this.items = this.items.slice(-this.maxLines);
    }
  }
}
