import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { config, ensureDirs } from './config.js';
import { logger } from './logger.js';
import { ApiError } from './http/errors.js';
import { registerRoutes } from './routes/index.js';

const MIME_BY_EXT: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
};

export async function buildApp(): Promise<FastifyInstance> {
  ensureDirs();
  const app = Fastify({
    logger: false,
    bodyLimit: 128 * 1024 * 1024
  });

  // 错误处理必须在任何 register() 之前注册：Fastify 在 register 时创建封装上下文并继承当时的错误处理器
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      reply.status(err.httpStatus).send(err.toJSON());
      return;
    }
    const anyErr = err as { statusCode?: number; message?: string; name?: string; issues?: unknown };
    if (anyErr.name === 'ZodError') {
      const wrapped = new ApiError('PARAM_INVALID', '参数校验失败：' + String(anyErr.message).slice(0, 300), {
        issues: anyErr.issues ?? null
      });
      reply.status(wrapped.httpStatus).send(wrapped.toJSON());
      return;
    }
    if (anyErr.statusCode && anyErr.statusCode < 500) {
      const wrapped = new ApiError('PARAM_INVALID', anyErr.message ?? '参数错误');
      reply.status(wrapped.httpStatus).send(wrapped.toJSON());
      return;
    }
    logger.error('未捕获异常：' + (anyErr.message ?? String(err)), { service: 'api' });
    reply.status(500).send(new ApiError('INTERNAL', anyErr.message ?? '内部错误').toJSON());
  });

  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url && req.raw.url.startsWith('/api/')) {
      reply.status(404).send(new ApiError('NOT_FOUND', '接口不存在：' + req.raw.url).toJSON());
      return;
    }
    const indexFile = path.join(config.webDist, 'index.html');
    if (fs.existsSync(indexFile)) {
      reply.type('text/html').send(fs.readFileSync(indexFile));
      return;
    }
    reply.status(404).type('text/plain').send('玄枢・AURUM API 已启动；前端尚未构建（pnpm --filter @aurum/web build）');
  });

  await app.register(cors, { origin: true, methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'] });
  await app.register(websocket);

  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });
  app.addContentTypeParser('image/png', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
  app.addContentTypeParser('audio/wav', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

  app.addHook('onRequest', async (req) => {
    (req as unknown as { startedAt: number }).startedAt = Date.now();
  });

  app.addHook('onResponse', async (req, reply) => {
    const started = (req as unknown as { startedAt?: number }).startedAt ?? Date.now();
    logger.debug(req.method + ' ' + req.url + ' → ' + reply.statusCode, {
      service: 'api',
      latency_ms: Date.now() - started
    });
  });

  await registerRoutes(app);

  await app.register(fastifyStatic, {
    root: config.storageDir,
    prefix: '/files/',
    decorateReply: false
  });

  // 前端托管：动态解析（不依赖启动时的文件快照），未命中文件则回落 SPA 入口
  app.get('/*', async (req, reply) => {
    const rawPath = decodeURIComponent((req.raw.url ?? '/').split('?')[0]);
    if (rawPath.startsWith('/api/') || rawPath.startsWith('/files/')) {
      return reply.callNotFound();
    }
    const indexFile = path.join(config.webDist, 'index.html');
    const abs = path.normalize(path.join(config.webDist, rawPath));
    if (abs.startsWith(config.webDist) && fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      reply.type(MIME_BY_EXT[path.extname(abs).toLowerCase()] ?? 'application/octet-stream');
      reply.header('Cache-Control', rawPath.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      return reply.send(fs.readFileSync(abs));
    }
    if (fs.existsSync(indexFile)) {
      return reply.type('text/html; charset=utf-8').send(fs.readFileSync(indexFile));
    }
    return reply.status(404).type('text/plain; charset=utf-8').send('玄枢・AURUM API 已启动；前端尚未构建（pnpm --filter @aurum/web build）');
  });

  return app;
}
