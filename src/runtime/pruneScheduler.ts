/**
 * In-process IDE prune scheduler (startup + interval + low-disk).
 */

import type { PxhConfig } from '../types.js';
import { collectMetrics } from '../metrics/collector.js';
import { runIdePrune } from '../actions/pruneIde.js';
import type { MqttHub } from '../mqtt/hub.js';

export class PruneScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly cfg: PxhConfig,
    private readonly mqtt: MqttHub,
  ) {}

  start(): void {
    if (this.cfg.prune.schedule === 'manual_only') {
      console.log('[pxh] IDE prune schedule: manual_only');
      return;
    }
    void this.tick('startup');
    const ms = Math.max(1, this.cfg.prune.intervalHours) * 3600_000;
    this.timer = setInterval(() => {
      void this.tick('interval');
    }, ms);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(reason: string): Promise<void> {
    if (this.running) return;
    if (this.cfg.prune.schedule === 'manual_only') return;

    if (this.cfg.prune.schedule === 'low_disk' && reason === 'interval') {
      const snap = await collectMetrics(this.cfg);
      if (snap.diskLevel === 'ok') return;
    }

    this.running = true;
    try {
      console.log(`[pxh] IDE prune auto (${reason})…`);
      const result = await runIdePrune(false);
      console.log(`[pxh] IDE prune: ${result.message}`);
      this.mqtt.publishPruneResult(result);
    } catch (e) {
      console.warn('[pxh] IDE prune failed:', e instanceof Error ? e.message : e);
    } finally {
      this.running = false;
    }
  }
}
