/**
 * Optional MQTT publisher for health / disk / alerts.
 */

import mqtt, { type MqttClient } from 'mqtt';
import type { MetricsSnapshot, PxhConfig, ThresholdLevel } from '../types.js';

export class HealthPublisher {
  private client: MqttClient | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastDiskLevel: ThresholdLevel | null = null;
  private lastCriticalAffirm = 0;

  constructor(
    private readonly cfg: PxhConfig,
    private readonly collect: () => Promise<MetricsSnapshot>,
  ) {}

  start(): void {
    if (!this.cfg.mqtt.enabled) {
      console.log('[pxh] MQTT publisher disabled');
      return;
    }

    const opts: mqtt.IClientOptions = {
      reconnectPeriod: 5_000,
    };
    if (this.cfg.mqtt.username) {
      opts.username = this.cfg.mqtt.username;
      opts.password = this.cfg.mqtt.password || undefined;
    }

    this.client = mqtt.connect(this.cfg.mqtt.broker, opts);
    this.client.on('connect', () => console.log('[pxh] MQTT connected', this.cfg.mqtt.broker));
    this.client.on('error', (err) => console.warn('[pxh] MQTT error:', err.message));

    const ms = Math.max(5, this.cfg.mqtt.publishIntervalSeconds) * 1000;
    this.timer = setInterval(() => {
      void this.publishOnce();
    }, ms);
    void this.publishOnce();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.client) {
      await new Promise<void>((resolve) => this.client!.end(false, {}, () => resolve()));
      this.client = null;
    }
  }

  private topic(suffix: string): string {
    const base = this.cfg.mqtt.topicBase.replace(/\/$/, '');
    return `${base}/system/${suffix}`;
  }

  private async publishOnce(): Promise<void> {
    if (!this.client?.connected) return;
    try {
      const snap = await this.collect();
      const healthTopic = this.topic('health');
      const diskTopic = this.topic('disk');
      const alertsTopic = this.topic('alerts');

      this.client.publish(healthTopic, JSON.stringify(snap), { retain: true, qos: 0 });
      this.client.publish(
        diskTopic,
        JSON.stringify({
          diskRoot: snap.diskRoot,
          level: snap.diskLevel,
          ts: snap.timestamp,
        }),
        { retain: true, qos: 0 },
      );

      const crossed =
        this.lastDiskLevel !== null &&
        this.lastDiskLevel !== snap.diskLevel &&
        (snap.diskLevel === 'warn' || snap.diskLevel === 'critical');

      const now = Date.now();
      const reaffirmCritical =
        snap.diskLevel === 'critical' && now - this.lastCriticalAffirm > 5 * 60_000;

      if (crossed || reaffirmCritical) {
        const alert = {
          level: snap.diskLevel,
          type: 'disk',
          message:
            snap.diskLevel === 'critical'
              ? `Root disk critical: ${snap.diskRoot?.usedPercent}% used (${snap.diskRoot?.availableGb} GB free)`
              : `Root disk warning: ${snap.diskRoot?.usedPercent}% used (${snap.diskRoot?.availableGb} GB free)`,
          diskRoot: snap.diskRoot,
          ts: snap.timestamp,
        };
        this.client.publish(alertsTopic, JSON.stringify(alert), { retain: false, qos: 0 });
        if (snap.diskLevel === 'critical') this.lastCriticalAffirm = now;
      }

      this.lastDiskLevel = snap.diskLevel;
    } catch (err) {
      console.warn('[pxh] MQTT publish failed:', err instanceof Error ? err.message : err);
    }
  }
}
