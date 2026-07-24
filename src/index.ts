#!/usr/bin/env node
/**
 * Paradox Health Monitor (PxH) entry point.
 *
 *   pxh [--config /opt/paradox/config/pxh.ini] [--port 19090]
 */

import { Command } from 'commander';
import { loadConfig, resolveConfigPath } from './config/loadConfig.js';
import { createServer } from './server/server.js';
import { MqttHub } from './mqtt/hub.js';
import { collectMetrics } from './metrics/collector.js';
import { startAptUpdateCache, stopAptUpdateCache } from './metrics/aptUpdateCache.js';
import { getRuntimeServices } from './runtime/services.js';
import { RingBuffer } from './panels/ringBuffer.js';
import { PruneScheduler } from './runtime/pruneScheduler.js';
import { APP_VERSION } from './types.js';

const program = new Command();
program
  .name('pxh')
  .description('Paradox Health Monitor — host-local system health')
  .version(APP_VERSION)
  .option('-c, --config <path>', 'Path to pxh.ini')
  .option('-p, --port <number>', 'Override listen port')
  .parse(process.argv);

const opts = program.opts<{ config?: string; port?: string }>();
const configPath = resolveConfigPath(opts.config);
const config = loadConfig(configPath);
if (opts.port) config.server.port = parseInt(opts.port, 10);

const warningsBuf = new RingBuffer(
  config.warnings.historyLines,
  config.warnings.historyHours,
);
const journalBuf = new RingBuffer(config.journal.historyLines, config.journal.historyHours);
const propsBuf = new RingBuffer(config.props.historyLines, config.props.historyHours);

const mqtt = new MqttHub(
  config,
  () => collectMetrics(config),
  () => getRuntimeServices(config),
  warningsBuf,
  propsBuf,
);

const server = await createServer(config, { warningsBuf, journalBuf, propsBuf, mqtt });
const pruneScheduler = new PruneScheduler(config, mqtt);

try {
  await server.listen({ host: config.server.host, port: config.server.port });
  console.log(
    `[pxh] Paradox Health Monitor v${APP_VERSION} listening on http://${config.server.host}:${config.server.port}`,
  );
  if (config.server.serveUi) {
    console.log(`[pxh] System Health UI: http://${config.server.host}:${config.server.port}/ui/`);
  }
  mqtt.start();
  startAptUpdateCache();
  pruneScheduler.start();
} catch (err) {
  console.error('[pxh] Failed to start:', err);
  process.exit(1);
}

async function shutdown(signal: string): Promise<void> {
  console.log(`[pxh] Shutdown (${signal})…`);
  stopAptUpdateCache();
  pruneScheduler.stop();
  await mqtt.stop();
  await server.close();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
