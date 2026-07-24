/**
 * MQTT publish (health/disk/services/alerts) + subscribe (warnings/props).
 */

import mqtt, { type MqttClient } from 'mqtt';
import type { MetricsSnapshot, PanelLine, PxhConfig, ThresholdLevel, UpsStatus } from '../types.js';
import { mqttSystemTopic } from '../types.js';
import { matchWarningColor } from '../config/loadConfig.js';
import type { RingBuffer } from '../panels/ringBuffer.js';
import type { RuntimeServiceInfo } from '../types.js';

export type PanelListener = (channel: 'warnings' | 'props', line: PanelLine) => void;

export class MqttHub {
  private client: MqttClient | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastDiskLevel: ThresholdLevel | null = null;
  private lastCriticalAffirm = 0;
  private lastServiceAlertKey = '';
  private lastUpsStatus: UpsStatus | null = null;
  private lastUpsCriticalAffirm = 0;
  private listeners = new Set<PanelListener>();

  constructor(
    private readonly cfg: PxhConfig,
    private readonly collect: () => Promise<MetricsSnapshot>,
    private readonly getServices: () => Promise<RuntimeServiceInfo[]>,
    private readonly warningsBuf: RingBuffer,
    private readonly propsBuf: RingBuffer,
  ) {}

  onPanel(listener: PanelListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (!this.cfg.mqtt.enabled) {
      console.log('[pxh] MQTT disabled');
      return;
    }

    const opts: mqtt.IClientOptions = { reconnectPeriod: 5_000 };
    if (this.cfg.mqtt.username) {
      opts.username = this.cfg.mqtt.username;
      opts.password = this.cfg.mqtt.password || undefined;
    }

    this.client = mqtt.connect(this.cfg.mqtt.broker, opts);
    this.client.on('connect', () => {
      console.log('[pxh] MQTT connected', this.cfg.mqtt.broker);
      this.subscribePanels();
    });
    this.client.on('error', (err) => console.warn('[pxh] MQTT error:', err.message));
    this.client.on('message', (topic, buf) => this.onMessage(topic, buf));

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

  publishPruneResult(result: {
    ok: boolean;
    message: string;
    dryRun: boolean;
    bytesReclaimed: number;
  }): void {
    if (!this.client?.connected) return;
    const alert = {
      level: result.ok ? 'info' : 'warn',
      type: 'ide_prune',
      message: result.message,
      dryRun: result.dryRun,
      bytesReclaimed: result.bytesReclaimed,
      ts: new Date().toISOString(),
    };
    this.client.publish(mqttSystemTopic(this.cfg, 'alerts'), JSON.stringify(alert), {
      retain: false,
      qos: 0,
    });
  }

  private subscribePanels(): void {
    if (!this.client) return;
    const topics: string[] = [];
    if (this.cfg.warnings.enabled) {
      for (const rule of this.cfg.warnings.rules) topics.push(rule.pattern);
    }
    if (this.cfg.props.enabled) {
      topics.push(...this.cfg.props.topics);
    }
    for (const t of [...new Set(topics)]) {
      this.client.subscribe(t, (err) => {
        if (err) console.warn('[pxh] MQTT subscribe failed', t, err.message);
      });
    }
  }

  private onMessage(topic: string, buf: Buffer): void {
    let payload: unknown = buf.toString('utf8');
    try {
      payload = JSON.parse(String(payload));
    } catch {
      /* keep string */
    }

    if (this.cfg.props.enabled && this.cfg.props.topics.some((p) => topic === p || topic.startsWith(p + '/'))) {
      const line: PanelLine = {
        ts: new Date().toISOString(),
        topic,
        text: typeof payload === 'string' ? payload : JSON.stringify(payload),
        payload,
      };
      this.propsBuf.push(line);
      for (const l of this.listeners) l('props', line);
      return;
    }

    if (!this.cfg.warnings.enabled) return;
    const colorKey = matchWarningColor(topic, this.cfg.warnings.rules);
    const line: PanelLine = {
      ts: new Date().toISOString(),
      topic,
      colorKey,
      text: typeof payload === 'string' ? payload : JSON.stringify(payload),
      payload,
    };
    this.warningsBuf.push(line);
    for (const l of this.listeners) l('warnings', line);
  }

  private async publishOnce(): Promise<void> {
    if (!this.client?.connected) return;
    try {
      const snap = await this.collect();
      const services = await this.getServices();

      this.client.publish(mqttSystemTopic(this.cfg, 'health'), JSON.stringify(snap), {
        retain: true,
        qos: 0,
      });
      this.client.publish(
        mqttSystemTopic(this.cfg, 'disk'),
        JSON.stringify({
          diskRoot: snap.diskRoot,
          level: snap.diskLevel,
          ts: snap.timestamp,
        }),
        { retain: true, qos: 0 },
      );
      this.client.publish(mqttSystemTopic(this.cfg, 'services'), JSON.stringify({ services }), {
        retain: true,
        qos: 0,
      });
      this.client.publish(mqttSystemTopic(this.cfg, 'ups'), JSON.stringify(snap.ups), {
        retain: true,
        qos: 0,
      });


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
        this.client.publish(mqttSystemTopic(this.cfg, 'alerts'), JSON.stringify(alert), {
          retain: false,
          qos: 0,
        });
        if (snap.diskLevel === 'critical') this.lastCriticalAffirm = now;
      }

      this.lastDiskLevel = snap.diskLevel;

      const ups = snap.ups;
      const upsTransition = this.lastUpsStatus !== null && this.lastUpsStatus !== ups.status;
      const nowUps = Date.now();
      const upsCriticalHold =
        (ups.status === 'low_battery' || ups.level === 'critical') &&
        nowUps - this.lastUpsCriticalAffirm > 5 * 60_000;

      const publishUpsAlert = (type: string, level: ThresholdLevel, message: string) => {
        this.client!.publish(
          mqttSystemTopic(this.cfg, 'alerts'),
          JSON.stringify({ level, type, message, ups, ts: snap.timestamp }),
          { retain: false, qos: 0 },
        );
      };

      if (upsTransition) {
        if (ups.status === 'on_battery') {
          publishUpsAlert('ups_on_battery', 'warn', 'UPS on battery power');
        } else if (ups.status === 'low_battery') {
          publishUpsAlert('ups_low_battery', 'critical', 'UPS low battery');
          this.lastUpsCriticalAffirm = nowUps;
        } else if (ups.status === 'online' && this.lastUpsStatus === 'on_battery') {
          publishUpsAlert('ups_restored', 'ok', 'UPS restored to AC power');
        } else if (ups.status === 'no_comms' && this.cfg.ups.enabled) {
          publishUpsAlert('ups_no_comms', 'warn', 'UPS telemetry unavailable');
        } else if (ups.status === 'replace_battery') {
          publishUpsAlert('ups_replace_battery', 'warn', 'UPS battery replacement recommended');
        }
      } else if (upsCriticalHold) {
        publishUpsAlert('ups_low_battery', 'critical', 'UPS low battery');
        this.lastUpsCriticalAffirm = nowUps;
      }

      this.lastUpsStatus = ups.status;


      const badRequired = services.filter(
        (s) => s.tier === 'required' && (s.state === 'failed' || s.state === 'stopped'),
      );
      const key = badRequired.map((s) => `${s.name}:${s.state}`).join(',');
      if (key && key !== this.lastServiceAlertKey) {
        this.client.publish(
          mqttSystemTopic(this.cfg, 'alerts'),
          JSON.stringify({
            level: 'critical',
            type: 'service',
            message: `Required services not healthy: ${key}`,
            services: badRequired,
            ts: snap.timestamp,
          }),
          { retain: false, qos: 0 },
        );
      }
      this.lastServiceAlertKey = key;
    } catch (err) {
      console.warn('[pxh] MQTT publish failed:', err instanceof Error ? err.message : err);
    }
  }
}
