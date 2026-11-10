import { buildApp } from './app.js';
import { config, ensureDirs } from './config.js';
import { getDb } from './db/index.js';
import { logger } from './logger.js';
import { startScheduler } from './scheduler/scheduler.js';
import { runSeed } from './db/seed.js';

async function main(): Promise<void> {
  ensureDirs();
  getDb();
  await runSeed();
  const app = await buildApp();
  startScheduler();
  await app.listen({ port: config.port, host: config.host });
  logger.info('玄枢・AURUM API 已启动', { service: 'api', url: 'http://' + config.host + ':' + config.port });
  const shutdown = async (signal: string) => {
    logger.info('收到 ' + signal + '，正在优雅退出', { service: 'api' });
    try { await app.close(); } catch { /* ignore */ }
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error('启动失败：' + String(err?.stack ?? err), { service: 'api' });
  process.exit(1);
});
