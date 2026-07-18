/**
 * Fastify HTTP API for Paradox Health Monitor.
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import type { PxhConfig } from '../types.js';
import { APP_VERSION } from '../types.js';
import { collectMetrics } from '../metrics/collector.js';
import { getRuntimeServices } from '../runtime/services.js';
import {
  runUpgrade,
  runReboot,
  runServiceAction,
  runCleanup,
  runPruneIde,
} from '../actions/actions.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function createServer(cfg: PxhConfig) {
  const app = Fastify({ logger: false });

  app.get('/', async () => ({ status: 'ok', version: APP_VERSION, name: 'Paradox Health Monitor' }));
  app.get('/health', async () => ({ status: 'ok', version: APP_VERSION }));

  app.get('/metrics', async () => collectMetrics(cfg));

  app.get('/runtime', async () => ({
    services: await getRuntimeServices(cfg.runtime.services),
  }));

  app.post('/actions/upgrade', async (_req, reply) => {
    const result = await runUpgrade(cfg);
    return reply.code(result.ok ? 200 : 403).send(result);
  });

  app.post<{ Body: { confirm?: boolean } }>('/actions/restart', async (req, reply) => {
    const result = await runReboot(cfg, Boolean(req.body?.confirm));
    return reply.code(result.ok ? 200 : 400).send(result);
  });

  app.post<{ Body: { name?: string; action?: string } }>('/actions/service', async (req, reply) => {
    const name = req.body?.name;
    const action = req.body?.action;
    if (!name || !action || !['start', 'stop', 'restart'].includes(action)) {
      return reply.code(400).send({ ok: false, message: 'name and action (start|stop|restart) required' });
    }
    const result = await runServiceAction(cfg, name, action as 'start' | 'stop' | 'restart');
    return reply.code(result.ok ? 200 : 403).send(result);
  });

  app.post<{ Body: { targets?: string[]; confirm?: boolean; dryRun?: boolean } }>(
    '/actions/cleanup',
    async (req, reply) => {
      const targets = req.body?.targets ?? ['apt'];
      const result = await runCleanup(cfg, targets, Boolean(req.body?.confirm), Boolean(req.body?.dryRun));
      return reply.code(result.ok ? 200 : 400).send(result);
    },
  );

  app.post<{ Body: { confirm?: boolean; dryRun?: boolean } }>('/actions/prune-ide', async (req, reply) => {
    const result = await runPruneIde(cfg, Boolean(req.body?.confirm), Boolean(req.body?.dryRun));
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
