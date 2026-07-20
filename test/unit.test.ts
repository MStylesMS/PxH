import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadConfig,
  topicMatches,
  matchWarningColor,
} from '../src/config/loadConfig.js';
import { diskLevel } from '../src/metrics/collector.js';
import { mqttSystemTopic, mqttSystemPrefix } from '../src/types.js';
import { RingBuffer } from '../src/panels/ringBuffer.js';
import { encodeSession, decodeSession } from '../src/auth/session.js';

describe('topicMatches', () => {
  it('matches + and exact segments', () => {
    assert.equal(topicMatches('paradox/+/pfx/warnings', 'paradox/agent22/pfx/warnings'), true);
    assert.equal(topicMatches('paradox/+/pfx/warnings', 'paradox/agent22/pxo/warnings'), false);
  });
  it('matches # multilevel', () => {
    assert.equal(topicMatches('paradox/#', 'paradox/a/b/c'), true);
  });
});

describe('matchWarningColor', () => {
  const rules = [
    { pattern: 'paradox/+/pfx/warnings', color: 'pfx' },
    { pattern: 'paradox/+/+/warnings', color: 'game' },
  ];
  it('first match wins', () => {
    assert.equal(matchWarningColor('paradox/r/pfx/warnings', rules), 'pfx');
    assert.equal(matchWarningColor('paradox/r/game/warnings', rules), 'game');
  });
});

describe('diskLevel', () => {
  const thr = {
    diskWarnPercent: 85,
    diskCriticalPercent: 95,
    diskWarnFreeGb: 0,
    diskCriticalFreeGb: 1,
  };
  it('ok / warn / critical by percent', () => {
    assert.equal(diskLevel({ totalGb: 10, usedGb: 5, availableGb: 5, usedPercent: 50 }, thr), 'ok');
    // 90% warn by percent; keep availableGb > critical free-GB floor (1)
    assert.equal(diskLevel({ totalGb: 10, usedGb: 9, availableGb: 1.5, usedPercent: 90 }, thr), 'warn');
    assert.equal(
      diskLevel({ totalGb: 10, usedGb: 9.6, availableGb: 0.4, usedPercent: 96 }, thr),
      'critical',
    );
  });
  it('critical by free-GB floor', () => {
    assert.equal(
      diskLevel({ totalGb: 100, usedGb: 50, availableGb: 0.5, usedPercent: 50 }, thr),
      'critical',
    );
  });
});

describe('mqtt topics', () => {
  it('builds paradox/<id>/system/*', () => {
    const cfg = {
      mqtt: { topicRoot: 'paradox', topicBase: '' },
      machine: { id: 'agent22' },
    } as Parameters<typeof mqttSystemTopic>[0];
    assert.equal(mqttSystemPrefix(cfg), 'paradox/agent22');
    assert.equal(mqttSystemTopic(cfg, 'health'), 'paradox/agent22/system/health');
  });
  it('honors topic_base override', () => {
    const cfg = {
      mqtt: { topicRoot: 'paradox', topicBase: 'lab/custom' },
      machine: { id: 'x' },
    } as Parameters<typeof mqttSystemTopic>[0];
    assert.equal(mqttSystemTopic(cfg, 'disk'), 'lab/custom/system/disk');
  });
});

describe('RingBuffer', () => {
  it('evicts by max lines', () => {
    const b = new RingBuffer(3, 24);
    for (let i = 0; i < 5; i++) {
      b.push({ ts: new Date().toISOString(), text: String(i) });
    }
    assert.equal(b.list().length, 3);
    assert.equal(b.list()[0].text, '2');
  });
});

describe('loadConfig', () => {
  it('parses services tiers and topic_root', () => {
    const dir = resolve(tmpdir(), `pxh-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const path = resolve(dir, 'pxh.ini');
    writeFileSync(
      path,
      `[machine]
id = testhost
[mqtt]
topic_root = paradox
enabled = false
[services]
required = mosquitto,nginx
optional = paradox-health
user = custom-unit
[warnings]
rule.1.pattern = paradox/+/pfx/warnings
rule.1.color = pfx
`,
    );
    const cfg = loadConfig(path);
    assert.equal(cfg.machine.id, 'testhost');
    assert.equal(cfg.mqtt.topicRoot, 'paradox');
    assert.deepEqual(cfg.services.required, ['mosquitto', 'nginx']);
    assert.deepEqual(cfg.services.user, ['custom-unit']);
    assert.equal(cfg.warnings.rules[0].color, 'pfx');
    assert.equal(cfg.server.host, '0.0.0.0');
    unlinkSync(path);
  });
});

describe('session', () => {
  it('round-trips signed cookie payload', () => {
    const cfg = {
      actions: { sessionHours: 1, sessionSecret: 'test-secret-key-32chars-minimum!!' },
    } as Parameters<typeof encodeSession>[0];
    const token = encodeSession(cfg, 'paradox');
    const decoded = decodeSession(cfg, token);
    assert.ok(decoded);
    assert.equal(decoded!.u, 'paradox');
    assert.equal(decodeSession(cfg, 'tampered.token'), null);
  });
});
