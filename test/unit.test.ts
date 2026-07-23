import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  loadConfig,
  topicMatches,
  matchWarningColor,
} from '../src/config/loadConfig.js';
import { diskLevel, ramFromSiMem, cpuLevel, tempLevel, ramLevel } from '../src/metrics/collector.js';
import {
  parseUpscOutput,
  mapUpsStatus,
  buildUpsInfoFromVars,
  absentUps,
  resolveRealPowerWatts,
} from '../src/metrics/ups.js';
import {
  mqttSystemTopic,
  mqttSystemPrefix,
  DEFAULT_APP_PATHS,
} from '../src/types.js';
import {
  getAppVersions,
  mappedAppEntries,
  shapeCommitSelectOptions,
} from '../src/runtime/appVersions.js';
import { runAppUpdate } from '../src/actions/appUpdate.js';
import { RingBuffer } from '../src/panels/ringBuffer.js';
import { encodeSession, decodeSession } from '../src/auth/session.js';
import type { AppCommitInfo, PxhConfig } from '../src/types.js';
import {
  cmdlineMatchesUnit,
  findExtraProcesses,
  listProcessesFromPs,
  shortCmd,
} from '../src/runtime/processMatch.js';
import { parseUpgradeStatusJson } from '../src/actions/upgradeStatus.js';

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
    cpuWarnPercent: 80,
    cpuCriticalPercent: 95,
    tempWarnC: 70,
    tempCriticalC: 80,
    ramWarnPercent: 80,
    ramCriticalPercent: 95,
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

describe('cpuLevel', () => {
  const thr = {
    cpuWarnPercent: 80,
    cpuCriticalPercent: 95,
    tempWarnC: 70,
    tempCriticalC: 80,
    ramWarnPercent: 80,
    ramCriticalPercent: 95,
    diskWarnPercent: 85,
    diskCriticalPercent: 95,
    diskWarnFreeGb: 0,
    diskCriticalFreeGb: 1,
  };
  it('ok / warn / critical by percent', () => {
    assert.equal(cpuLevel(50, thr), 'ok');
    assert.equal(cpuLevel(80, thr), 'warn');
    assert.equal(cpuLevel(94.9, thr), 'warn');
    assert.equal(cpuLevel(95, thr), 'critical');
  });
});

describe('tempLevel', () => {
  const thr = {
    cpuWarnPercent: 80,
    cpuCriticalPercent: 95,
    tempWarnC: 70,
    tempCriticalC: 80,
    ramWarnPercent: 80,
    ramCriticalPercent: 95,
    diskWarnPercent: 85,
    diskCriticalPercent: 95,
    diskWarnFreeGb: 0,
    diskCriticalFreeGb: 1,
  };
  it('ok / warn / critical by °C; null is ok', () => {
    assert.equal(tempLevel(null, thr), 'ok');
    assert.equal(tempLevel(65, thr), 'ok');
    assert.equal(tempLevel(70, thr), 'warn');
    assert.equal(tempLevel(79.9, thr), 'warn');
    assert.equal(tempLevel(80, thr), 'critical');
  });
});

describe('ramLevel', () => {
  const thr = {
    cpuWarnPercent: 80,
    cpuCriticalPercent: 95,
    tempWarnC: 70,
    tempCriticalC: 80,
    ramWarnPercent: 80,
    ramCriticalPercent: 95,
    diskWarnPercent: 85,
    diskCriticalPercent: 95,
    diskWarnFreeGb: 0,
    diskCriticalFreeGb: 1,
  };
  it('ok / warn / critical by used percent', () => {
    assert.equal(ramLevel(44.8, thr), 'ok');
    assert.equal(ramLevel(80, thr), 'warn');
    assert.equal(ramLevel(94.9, thr), 'warn');
    assert.equal(ramLevel(95, thr), 'critical');
  });
});
describe('ramFromSiMem', () => {
  it('uses MemAvailable (total − available), not total − free', () => {
    // 1795 MiB total, ~991 MiB available → ~45% used (Agent 22-like)
    const total = 1795 * 1024 * 1024;
    const available = 991 * 1024 * 1024;
    const ram = ramFromSiMem({ total, available });
    assert.equal(ram.totalMb, 1795);
    assert.equal(ram.usedMb, 1795 - 991);
    assert.equal(ram.usedPercent, 44.8);
  });
  it('clamps when available exceeds total', () => {
    const ram = ramFromSiMem({ total: 1000, available: 2000 });
    assert.equal(ram.usedMb, 0);
    assert.equal(ram.usedPercent, 0);
  });
});

describe('ups metrics', () => {
  const upsCfg = {
    enabled: true,
    backend: 'auto' as const,
    nutUps: 'ups@127.0.0.1',
    apcupsdHost: '127.0.0.1:3551',
    batteryWarnPercent: 50,
    batteryCriticalPercent: 20,
    runtimeWarnMinutes: 15,
    runtimeCriticalMinutes: 5,
  };

  it('parses upsc key: value lines', () => {
    const vars = parseUpscOutput('battery.charge: 92\nbattery.runtime: 3600\nups.status: OL CHRG\n');
    assert.equal(vars['battery.charge'], '92');
    assert.equal(vars['ups.status'], 'OL CHRG');
  });

  it('maps OL / OB / LB tokens', () => {
    assert.equal(mapUpsStatus('OL CHRG'), 'charging');
    assert.equal(mapUpsStatus('OL'), 'online');
    assert.equal(mapUpsStatus('OB'), 'on_battery');
    assert.equal(mapUpsStatus('OB LB'), 'low_battery');
  });

  it('builds UpsInfo and levels on battery', () => {
    const info = buildUpsInfoFromVars(
      {
        'ups.status': 'OB',
        'battery.charge': '40',
        'battery.runtime': '600',
        'ups.load': '22',
      },
      'nut',
      upsCfg,
    );
    assert.equal(info.present, true);
    assert.equal(info.runtimeMinutes, 10);
    assert.equal(info.status, 'on_battery');
    assert.equal(info.level, 'warn');
    assert.equal(info.realPowerWatts, null);
  });

  it('estimates watts from load × nominal when realpower absent', () => {
    assert.equal(resolveRealPowerWatts(19, null, 660), 125);
    assert.equal(resolveRealPowerWatts(22, 140, 660), 140);
    assert.equal(resolveRealPowerWatts(null, null, 660), null);

    const info = buildUpsInfoFromVars(
      {
        'ups.status': 'OL',
        'battery.charge': '100',
        'battery.runtime': '1800',
        'ups.load': '19',
        'ups.realpower.nominal': '660',
      },
      'nut',
      upsCfg,
    );
    assert.equal(info.realPowerNominalWatts, 660);
    assert.equal(info.realPowerWatts, 125);
    assert.equal(info.status, 'online');
  });

  it('absent when disabled config path returns none', () => {
    const a = absentUps();
    assert.equal(a.status, 'none');
    assert.equal(a.present, false);
    assert.equal(a.realPowerWatts, null);
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
    assert.equal(cfg.services.scanConflicts, true);
    assert.equal(cfg.warnings.rules[0].color, 'pfx');
    assert.equal(cfg.server.host, '0.0.0.0');
    assert.equal(cfg.thresholds.cpuWarnPercent, 80);
    assert.equal(cfg.thresholds.tempCriticalC, 80);
    assert.equal(cfg.thresholds.ramWarnPercent, 80);
    assert.equal(cfg.apps['paradox-health'], DEFAULT_APP_PATHS['paradox-health']);
    assert.equal(cfg.apps.pxo, DEFAULT_APP_PATHS.pxo);
    unlinkSync(path);
  });

  it('overlays [apps] paths and allows clearing a default', () => {
    const dir = resolve(tmpdir(), `pxh-apps-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const path = resolve(dir, 'pxh.ini');
    writeFileSync(
      path,
      `[machine]
id = t
[apps]
pxo = /custom/PxO
pfx =
`,
    );
    const cfg = loadConfig(path);
    assert.equal(cfg.apps.pxo, '/custom/PxO');
    assert.equal(cfg.apps.pfx, undefined);
    assert.equal(cfg.apps['paradox-health'], DEFAULT_APP_PATHS['paradox-health']);
    assert.equal(cfg.actions.allowAppUpdate, true);
    unlinkSync(path);
  });

  it('honors allow_app_update = false', () => {
    const dir = resolve(tmpdir(), `pxh-allow-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const path = resolve(dir, 'pxh.ini');
    writeFileSync(
      path,
      `[machine]
id = t
[actions]
allow_app_update = false
`,
    );
    const cfg = loadConfig(path);
    assert.equal(cfg.actions.allowAppUpdate, false);
    unlinkSync(path);
  });
});

describe('appVersions', () => {
  it('maps only allowlisted service units', () => {
    const cfg = {
      services: {
        required: ['pxo', 'nginx'],
        optional: ['paradox-health'],
        user: [],
      },
      apps: {
        pxo: '/opt/paradox/apps/PxO',
        'paradox-health': '/opt/paradox/apps/PxH',
        // In apps map but not in services allowlist → excluded
        pxb: '/opt/paradox/apps/PxB',
      },
    } as Parameters<typeof mappedAppEntries>[0];
    const entries = mappedAppEntries(cfg);
    assert.deepEqual(
      entries.map((e) => e.name),
      ['paradox-health', 'pxo'],
    );
  });

  it('reports behind commits against a local origin', () => {
    const root = resolve(tmpdir(), `pxh-git-${Date.now()}`);
    const bare = resolve(root, 'origin.git');
    const work = resolve(root, 'work');
    mkdirSync(root, { recursive: true });
    execFileSync('git', ['init', '--bare', bare], { stdio: 'ignore' });
    execFileSync('git', ['clone', bare, work], { stdio: 'ignore' });
    const git = (args: string[], cwd = work) =>
      execFileSync('git', ['-C', cwd, ...args], {
        stdio: 'ignore',
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'Test',
          GIT_AUTHOR_EMAIL: 't@example.com',
          GIT_COMMITTER_NAME: 'Test',
          GIT_COMMITTER_EMAIL: 't@example.com',
        },
      });
    writeFileSync(resolve(work, 'a.txt'), 'one\n');
    git(['add', 'a.txt']);
    git(['commit', '-m', 'first']);
    git(['branch', '-M', 'main']);
    git(['push', '-u', 'origin', 'main']);
    execFileSync('git', ['-C', bare, 'symbolic-ref', 'HEAD', 'refs/heads/main'], {
      stdio: 'ignore',
    });

    // Advance origin with two commits via a second clone
    const other = resolve(root, 'other');
    execFileSync('git', ['clone', '-b', 'main', bare, other], { stdio: 'ignore' });
    const gitOther = (args: string[]) =>
      execFileSync('git', ['-C', other, ...args], {
        stdio: 'ignore',
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'Test',
          GIT_AUTHOR_EMAIL: 't@example.com',
          GIT_COMMITTER_NAME: 'Test',
          GIT_COMMITTER_EMAIL: 't@example.com',
        },
      });
    writeFileSync(resolve(other, 'b.txt'), 'two\n');
    gitOther(['add', 'b.txt']);
    gitOther(['commit', '-m', 'second newer']);
    writeFileSync(resolve(other, 'c.txt'), 'three\n');
    gitOther(['add', 'c.txt']);
    gitOther(['commit', '-m', 'third newer']);
    gitOther(['push', 'origin', 'main']);

    const cfg = {
      services: { required: ['demo'], optional: [], user: [] },
      apps: { demo: work },
    } as Parameters<typeof getAppVersions>[0];

    return getAppVersions(cfg).then((apps) => {
      assert.equal(apps.length, 1);
      const a = apps[0];
      assert.equal(a.name, 'demo');
      assert.equal(a.git, true);
      assert.equal(a.branch, 'main');
      assert.equal(a.behind, 2);
      assert.equal(a.ahead, 0);
      assert.ok(a.originUrl);
      assert.ok(a.originBranches.includes('main'));
      assert.equal(a.newerCommits.length, 2);
      assert.equal(a.newerCommits[0].subject, 'third newer');
      assert.equal(a.newerCommits[1].subject, 'second newer');
      rmSync(root, { recursive: true, force: true });
    });
  });

  it('shapes commit select with gap when behind > 4', () => {
    const mk = (n: number): AppCommitInfo => ({
      sha: `sha${n}`,
      short: `s${n}`,
      subject: `c${n}`,
      body: '',
      author: 't',
      date: '2026-07-21T00:00:00Z',
    });
    const commits = [6, 5, 4, 3, 2, 1, 0].map(mk);
    const head = mk(0);
    const opts = shapeCommitSelectOptions({
      commits,
      head,
      headSha: head.sha,
      behind: 6,
      selectedBranch: 'main',
      currentBranch: 'main',
    });
    assert.equal(opts.length, 6); // 4 + gap + current
    assert.equal(opts[0].kind, 'commit');
    assert.equal(opts[3].kind, 'commit');
    assert.equal(opts[4].kind, 'gap');
    if (opts[4].kind === 'gap') assert.equal(opts[4].more, 2);
    assert.equal(opts[5].kind, 'commit');
    if (opts[5].kind === 'commit') {
      assert.equal(opts[5].current, true);
      assert.equal(opts[5].commit.sha, 'sha0');
    }
  });

  it('shapes commit select as last 5 when not far behind', () => {
    const mk = (n: number): AppCommitInfo => ({
      sha: `sha${n}`,
      short: `s${n}`,
      subject: `c${n}`,
      body: '',
      author: 't',
      date: '2026-07-21T00:00:00Z',
    });
    const commits = [4, 3, 2, 1, 0].map(mk);
    const opts = shapeCommitSelectOptions({
      commits,
      head: mk(0),
      headSha: 'sha0',
      behind: 4,
      selectedBranch: 'main',
      currentBranch: 'main',
    });
    assert.equal(opts.length, 5);
    assert.ok(opts.every((o) => o.kind === 'commit'));
    assert.equal(opts[4].kind, 'commit');
    if (opts[4].kind === 'commit') assert.equal(opts[4].current, true);
  });
});

describe('appUpdate', () => {
  function makeCfg(work: string): PxhConfig {
    return {
      actions: {
        enabled: true,
        allowAppUpdate: true,
        allowUpgrade: true,
        allowReboot: true,
        allowService: true,
        allowCleanup: true,
        allowPruneIde: true,
        sessionHours: 1,
        allowedUsers: [],
        sessionSecret: 'test',
      },
      services: { required: ['demo'], optional: [], user: [] },
      apps: { demo: work },
    } as PxhConfig;
  }

  it('refuses dirty working tree', async () => {
    const root = resolve(tmpdir(), `pxh-dirty-${Date.now()}`);
    const bare = resolve(root, 'origin.git');
    const work = resolve(root, 'work');
    mkdirSync(root, { recursive: true });
    execFileSync('git', ['init', '--bare', bare], { stdio: 'ignore' });
    execFileSync('git', ['clone', bare, work], { stdio: 'ignore' });
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 't@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 't@example.com',
    };
    writeFileSync(resolve(work, 'a.txt'), 'one\n');
    execFileSync('git', ['-C', work, 'add', 'a.txt'], { stdio: 'ignore', env });
    execFileSync('git', ['-C', work, 'commit', '-m', 'first'], { stdio: 'ignore', env });
    execFileSync('git', ['-C', work, 'branch', '-M', 'main'], { stdio: 'ignore', env });
    execFileSync('git', ['-C', work, 'push', '-u', 'origin', 'main'], { stdio: 'ignore', env });
    writeFileSync(resolve(work, 'a.txt'), 'dirty\n');

    const sha = execFileSync('git', ['-C', work, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    const result = await runAppUpdate(makeCfg(work), 'demo', 'main', sha, true);
    assert.equal(result.ok, false);
    assert.match(result.message, /dirty/i);
    rmSync(root, { recursive: true, force: true });
  });

  it('refuses sha not on origin branch', async () => {
    const root = resolve(tmpdir(), `pxh-sha-${Date.now()}`);
    const bare = resolve(root, 'origin.git');
    const work = resolve(root, 'work');
    mkdirSync(root, { recursive: true });
    execFileSync('git', ['init', '--bare', bare], { stdio: 'ignore' });
    execFileSync('git', ['clone', bare, work], { stdio: 'ignore' });
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 't@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 't@example.com',
    };
    writeFileSync(resolve(work, 'a.txt'), 'one\n');
    execFileSync('git', ['-C', work, 'add', 'a.txt'], { stdio: 'ignore', env });
    execFileSync('git', ['-C', work, 'commit', '-m', 'first'], { stdio: 'ignore', env });
    execFileSync('git', ['-C', work, 'branch', '-M', 'main'], { stdio: 'ignore', env });
    execFileSync('git', ['-C', work, 'push', '-u', 'origin', 'main'], { stdio: 'ignore', env });

    // Orphan commit not pushed / not on origin/main
    execFileSync('git', ['-C', work, 'checkout', '--orphan', 'orphan'], {
      stdio: 'ignore',
      env,
    });
    writeFileSync(resolve(work, 'o.txt'), 'orphan\n');
    execFileSync('git', ['-C', work, 'add', 'o.txt'], { stdio: 'ignore', env });
    execFileSync('git', ['-C', work, 'commit', '-m', 'orphan'], { stdio: 'ignore', env });
    const orphanSha = execFileSync('git', ['-C', work, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    execFileSync('git', ['-C', work, 'checkout', 'main'], { stdio: 'ignore', env });

    const result = await runAppUpdate(makeCfg(work), 'demo', 'main', orphanSha, true);
    assert.equal(result.ok, false);
    assert.match(result.message, /not on origin/i);
    rmSync(root, { recursive: true, force: true });
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

describe('processMatch', () => {
  it('matches known unit cmdlines', () => {
    assert.equal(
      cmdlineMatchesUnit('pxo', 'node /opt/paradox/apps/PxO/src/game.js --config /opt/paradox/config/pxo.ini'),
      true,
    );
    assert.equal(
      cmdlineMatchesUnit('pfx', '/usr/local/bin/node /opt/paradox/apps/PFx/pfx.js --config /x'),
      true,
    );
    assert.equal(cmdlineMatchesUnit('pio', '/usr/local/bin/pio --config /opt/paradox/config/pio.ini'), true);
    assert.equal(cmdlineMatchesUnit('pio', 'something else'), false);
    assert.equal(cmdlineMatchesUnit('nginx', '/usr/sbin/nginx -g daemon on;'), true);
  });

  it('parses ps output and finds extras outside owned set', () => {
    const procs = listProcessesFromPs(`
  100 /usr/bin/node /opt/paradox/apps/PxO/src/game.js --config a
  200 /usr/bin/node /opt/paradox/apps/PxO/src/game.js --config b
  250 /bin/bash -c node /opt/paradox/apps/PxO/src/game.js embedded in shell text
  300 /usr/sbin/nginx -g daemon on;
`);
    assert.equal(procs.length, 4);
    const extras = findExtraProcesses('pxo', procs, new Set([100]));
    assert.deepEqual(
      extras.map((e) => e.pid),
      [200],
    );
  });

  it('shortCmd truncates', () => {
    assert.equal(shortCmd('abc', 10), 'abc');
    assert.equal(shortCmd('abcdefghijklmnopqrstuvwxyz', 10).endsWith('…'), true);
  });
});

describe('parseUpgradeStatusJson', () => {
  it('parses a valid in-progress status', () => {
    const st = parseUpgradeStatusJson(
      JSON.stringify({
        inProgress: true,
        phase: 'upgrade',
        message: 'Configuring firefox…',
        completed: 3,
        total: 10,
        startedAt: '2026-07-22T12:00:00Z',
        finishedAt: null,
        ok: null,
      }),
    );
    assert.ok(st);
    assert.equal(st!.inProgress, true);
    assert.equal(st!.completed, 3);
    assert.equal(st!.total, 10);
    assert.equal(st!.phase, 'upgrade');
  });
  it('returns null for invalid JSON or missing inProgress', () => {
    assert.equal(parseUpgradeStatusJson('{'), null);
    assert.equal(parseUpgradeStatusJson('{"phase":"upgrade"}'), null);
  });
});
