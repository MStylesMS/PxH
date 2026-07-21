/**
 * Fastify HTTP + WebSocket API for Paradox Health Monitor.
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCookie from '@fastify/cookie';
import fastifyWebsocket from '@fastify/websocket';
import type { PxhConfig } from '../types.js';
import { APP_VERSION } from '../types.js';
import { collectMetrics } from '../metrics/collector.js';
import { getRuntimeServices } from '../runtime/services.js';
import { getAppVersions } from '../runtime/appVersions.js';
import {
  runUpgrade,
  runReboot,
  runServiceAction,
  runCleanup,
  runPruneIdeAction,
} from '../actions/actions.js';
import { pamAuthenticate } from '../auth/pam.js';
import {
  clearSessionCookie,
  getSession,
  requireSession,
  setSessionCookie,
} from '../auth/session.js';
import type { RingBuffer } from '../panels/ringBuffer.js';
import { pollJournal } from '../panels/journal.js';
import type { MqttHub } from '../mqtt/hub.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface ServerDeps {
  warningsBuf: RingBuffer;
  journalBuf: RingBuffer;
  propsBuf: RingBuffer;
  mqtt: MqttHub;
}

type WsClient = {
  socket: { send: (data: string) => void; readyState: number; on: Function };
  channels: Set<string>;
};

export async function createServer(cfg: PxhConfig, deps: ServerDeps) {
  const app = Fastify({ logger: false });
  await app.register(fastifyCookie);
  await app.register(fastifyWebsocket);

  const wsClients = new Set<WsClient>();

  const broadcast = (channel: string, data: unknown) => {
    const msg = JSON.stringify({ channel, data });
    for (const c of wsClients) {
      if (c.channels.has(channel) && c.socket.readyState === 1) {
        try {
          c.socket.send(msg);
        } catch {
          /* */
        }
      }
    }
  };

  /** Action progress goes to every connected WS client (no subscribe required). */
  const broadcastAction = (data: {
    phase: 'start' | 'progress' | 'done' | 'error';
    name: string;
    message: string;
  }) => {
    const msg = JSON.stringify({ channel: 'action', data });
    for (const c of wsClients) {
      if (c.socket.readyState === 1) {
        try {
          c.socket.send(msg);
        } catch {
          /* */
        }
      }
    }
  };

  deps.mqtt.onPanel((channel, line) => broadcast(channel, line));

  // Periodic metrics/services/journal for WS subscribers
  const pushTimer = setInterval(() => {
    void (async () => {
      if (![...wsClients].some((c) => c.channels.has('metrics') || c.channels.has('services') || c.channels.has('journal'))) {
        return;
      }
      try {
        if ([...wsClients].some((c) => c.channels.has('metrics'))) {
          broadcast('metrics', await collectMetrics(cfg));
        }
        if ([...wsClients].some((c) => c.channels.has('services'))) {
          broadcast('services', { services: await getRuntimeServices(cfg) });
        }
        if ([...wsClients].some((c) => c.channels.has('journal'))) {
          await pollJournal(cfg, deps.journalBuf);
          broadcast('journal', { lines: deps.journalBuf.list({ lines: 20 }) });
        }
      } catch {
        /* */
      }
    })();
  }, Math.max(5, cfg.ui.refreshSeconds) * 1000);

  app.addHook('onClose', async () => {
    clearInterval(pushTimer);
  });

  app.get('/', async () => ({
    status: 'ok',
    version: APP_VERSION,
    name: 'Paradox Health Monitor',
  }));
  app.get('/health', async () => ({ status: 'ok', version: APP_VERSION }));

  app.get('/metrics', async (req) => {
    const q = req.query as { topConsumers?: string };
    return collectMetrics(cfg, { topConsumers: q.topConsumers === '1' || q.topConsumers === 'true' });
  });

  app.get('/services', async () => ({
    services: await getRuntimeServices(cfg),
  }));
  app.get('/runtime', async () => ({
    services: await getRuntimeServices(cfg),
  }));

  /** Git version inventory for Paradox apps (fetch on demand — not WS). */
  app.get('/apps/versions', async () => ({
    apps: await getAppVersions(cfg),
  }));

  /** Server-side probe of nginx /health/ (avoids browser cross-origin from :19090). */
  app.get('/reachability/nginx-health', async () => {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 3000);
      const r = await fetch('http://127.0.0.1/health/', {
        method: 'GET',
        signal: controller.signal,
        redirect: 'manual',
      });
      clearTimeout(t);
      return { ok: r.ok || r.status === 200, status: r.status };
    } catch (e) {
      return {
        ok: false,
        status: 0,
        message: e instanceof Error ? e.message : String(e),
      };
    }
  });

  // ── Auth ────────────────────────────────────────────────────────────
  app.post<{ Body: { username?: string; password?: string } }>('/auth/login', async (req, reply) => {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    if (!username || !password) {
      return reply.code(400).send({ ok: false, message: 'username and password required' });
    }
    if (
      cfg.actions.allowedUsers.length > 0 &&
      !cfg.actions.allowedUsers.includes(username.toLowerCase())
    ) {
      return reply.code(403).send({ ok: false, message: 'user not allowlisted in pxh.ini' });
    }
    const result = await pamAuthenticate(username, password);
    if (!result.ok) {
      return reply.code(403).send({ ok: false, message: result.message });
    }
    setSessionCookie(reply, cfg, username);
    return { ok: true, username };
  });

  app.post('/auth/logout', async (_req, reply) => {
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get('/auth/session', async (req) => {
    const session = getSession(req, cfg);
    return session
      ? { authenticated: true, username: session.u }
      : { authenticated: false };
  });

  // ── Panels ──────────────────────────────────────────────────────────
  app.get('/panels/warnings', async (req) => {
    const q = req.query as { lines?: string; since?: string };
    return {
      lines: deps.warningsBuf.list({
        lines: q.lines ? Number(q.lines) : undefined,
        since: q.since,
      }),
    };
  });

  app.get('/panels/journal', async (req) => {
    await pollJournal(cfg, deps.journalBuf);
    const q = req.query as { lines?: string; since?: string };
    return {
      lines: deps.journalBuf.list({
        lines: q.lines ? Number(q.lines) : undefined,
        since: q.since,
      }),
    };
  });

  app.get('/panels/props', async (req) => {
    const q = req.query as { lines?: string; since?: string };
    return {
      lines: deps.propsBuf.list({
        lines: q.lines ? Number(q.lines) : undefined,
        since: q.since,
      }),
    };
  });

  app.get('/panels/meta', async () => ({
    theme: cfg.ui.theme,
    refreshSeconds: cfg.ui.refreshSeconds,
    warningColors: cfg.warnings.colors,
    history: {
      warnings: { lines: cfg.warnings.historyLines, hours: cfg.warnings.historyHours },
      journal: { lines: cfg.journal.historyLines, hours: cfg.journal.historyHours },
      props: { lines: cfg.props.historyLines, hours: cfg.props.historyHours },
    },
  }));

  // ── WebSocket ───────────────────────────────────────────────────────
  app.get('/ws', { websocket: true }, (socket) => {
    const client: WsClient = { socket, channels: new Set() };
    wsClients.add(client);
    socket.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          op?: string;
          channels?: string[];
        };
        if (msg.op === 'subscribe' && Array.isArray(msg.channels)) {
          for (const ch of msg.channels) client.channels.add(ch);
          void (async () => {
            if (client.channels.has('metrics')) {
              socket.send(JSON.stringify({ channel: 'metrics', data: await collectMetrics(cfg) }));
            }
            if (client.channels.has('services')) {
              socket.send(
                JSON.stringify({
                  channel: 'services',
                  data: { services: await getRuntimeServices(cfg) },
                }),
              );
            }
            if (client.channels.has('warnings')) {
              socket.send(
                JSON.stringify({ channel: 'warnings', data: { lines: deps.warningsBuf.list() } }),
              );
            }
            if (client.channels.has('props')) {
              socket.send(
                JSON.stringify({ channel: 'props', data: { lines: deps.propsBuf.list() } }),
              );
            }
            if (client.channels.has('journal')) {
              await pollJournal(cfg, deps.journalBuf);
              socket.send(
                JSON.stringify({ channel: 'journal', data: { lines: deps.journalBuf.list() } }),
              );
            }
          })();
        }
      } catch {
        /* */
      }
    });
    socket.on('close', () => wsClients.delete(client));
  });

  // ── Actions (session required) ──────────────────────────────────────
  app.post('/actions/upgrade', async (req, reply) => {
    if (!requireSession(req, reply, cfg)) return;
    broadcastAction({ phase: 'start', name: 'upgrade', message: 'Upgrade started…' });
    const result = await runUpgrade(cfg, (step) =>
      broadcastAction({ phase: 'progress', name: 'upgrade', message: step }),
    );
    broadcastAction({
      phase: result.ok ? 'done' : 'error',
      name: 'upgrade',
      message: result.message,
    });
    return reply.code(result.ok ? 200 : 403).send(result);
  });

  app.post<{ Body: { confirm?: boolean } }>('/actions/restart', async (req, reply) => {
    if (!requireSession(req, reply, cfg)) return;
    const result = await runReboot(cfg, Boolean(req.body?.confirm));
    return reply.code(result.ok ? 200 : 400).send(result);
  });

  app.post<{ Body: { name?: string; action?: string } }>('/actions/service', async (req, reply) => {
    if (!requireSession(req, reply, cfg)) return;
    const name = req.body?.name;
    const action = req.body?.action;
    const allowed = ['start', 'stop', 'restart', 'enable', 'disable'] as const;
    if (!name || !action || !(allowed as readonly string[]).includes(action)) {
      return reply.code(400).send({
        ok: false,
        message: 'name and action (start|stop|restart|enable|disable) required',
      });
    }
    broadcastAction({
      phase: 'start',
      name: 'service',
      message: `${action} ${name}…`,
    });
    const result = await runServiceAction(
      cfg,
      name,
      action as 'start' | 'stop' | 'restart' | 'enable' | 'disable',
    );
    broadcastAction({
      phase: result.ok ? 'done' : 'error',
      name: 'service',
      message: result.message,
    });
    if (result.ok) {
      broadcast('services', { services: await getRuntimeServices(cfg) });
    }
    return reply.code(result.ok ? 200 : 403).send(result);
  });

  app.post<{ Body: { targets?: string[]; confirm?: boolean; dryRun?: boolean } }>(
    '/actions/cleanup',
    async (req, reply) => {
      if (!requireSession(req, reply, cfg)) return;
      const targets = req.body?.targets ?? ['apt', 'npm'];
      broadcastAction({ phase: 'start', name: 'cleanup', message: 'Cleanup started…' });
      const result = await runCleanup(
        cfg,
        targets,
        Boolean(req.body?.confirm),
        Boolean(req.body?.dryRun),
        (step) => broadcastAction({ phase: 'progress', name: 'cleanup', message: step }),
      );
      broadcastAction({
        phase: result.ok ? 'done' : 'error',
        name: 'cleanup',
        message: result.message,
      });
      return reply.code(result.ok ? 200 : 400).send(result);
    },
  );

  app.post<{ Body: { confirm?: boolean; dryRun?: boolean } }>(
    '/actions/prune-ide',
    async (req, reply) => {
      if (!requireSession(req, reply, cfg)) return;
      const dryRun = Boolean(req.body?.dryRun);
      broadcastAction({
        phase: 'start',
        name: 'prune-ide',
        message: dryRun ? 'IDE prune dry-run started…' : 'IDE prune started…',
      });
      const result = await runPruneIdeAction(
        cfg,
        Boolean(req.body?.confirm),
        dryRun,
        (step) => broadcastAction({ phase: 'progress', name: 'prune-ide', message: step }),
      );
      broadcastAction({
        phase: result.ok ? 'done' : 'error',
        name: 'prune-ide',
        message: result.message,
      });
      if (result.ok) deps.mqtt.publishPruneResult(result);
      return reply.code(result.ok ? 200 : 400).send(result);
    },
  );

  app.get('/actions/prune-ide/preview', async (req, reply) => {
    if (!requireSession(req, reply, cfg)) return;
    broadcastAction({
      phase: 'start',
      name: 'prune-ide',
      message: 'IDE prune preview (dry-run)…',
    });
    const result = await runPruneIdeAction(cfg, false, true, (step) =>
      broadcastAction({ phase: 'progress', name: 'prune-ide', message: step }),
    );
    broadcastAction({
      phase: result.ok ? 'done' : 'error',
      name: 'prune-ide',
      message: result.message,
    });
    return reply.code(result.ok ? 200 : 400).send(result);
  });

  if (cfg.server.serveUi) {
    const root = resolve(__dirname, '../../public');
    await app.register(fastifyStatic, {
      root,
      prefix: '/ui/',
    });
  }

  return app;
}
