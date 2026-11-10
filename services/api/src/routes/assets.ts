import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { all, get, json, nowIso, run } from '../db/index.js';
import { badRequest, notFound } from '../http/errors.js';
import { assetKey, createAsset, findAsset, listAssets, objectPath, putObject } from '../adapters/storage.js';

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.srt': 'text/plain; charset=utf-8',
  '.ass': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

function mimeOf(key: string): string {
  return MIME[path.extname(key).toLowerCase()] ?? 'application/octet-stream';
}

export async function registerAssetRoutes(app: FastifyInstance): Promise<void> {
  app.get('/assets/:id', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const asset = findAsset(id);
    if (!asset) throw notFound('素材不存在');
    return asset;
  });

  app.get('/assets/:id/raw', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const asset = findAsset(id);
    if (!asset) throw notFound('素材不存在');
    const abs = objectPath(asset.bucket, asset.object_key);
    if (!fs.existsSync(abs)) {
      reply.status(404).type('text/plain').send('文件缺失：' + asset.object_key);
      return;
    }
    const stat = fs.statSync(abs);
    if (stat.size === 0) {
      reply.status(204).send();
      return;
    }
    const mime = mimeOf(asset.object_key);
    const range = String((req.headers as Record<string, string | undefined>).range ?? '').trim();
    // 支持 Range：成片拖动进度条、边下边播依赖 206
    if (/^bytes=\d*-\d*$/.test(range)) {
      const [startRaw, endRaw] = range.replace('bytes=', '').split('-');
      const start = startRaw ? Number(startRaw) : 0;
      const end = endRaw ? Math.min(Number(endRaw), stat.size - 1) : stat.size - 1;
      if (!Number.isFinite(start) || start >= stat.size || end < start) {
        reply.status(416).header('Content-Range', 'bytes */' + stat.size).send();
        return;
      }
      reply
        .status(206)
        .type(mime)
        .header('Accept-Ranges', 'bytes')
        .header('Content-Range', 'bytes ' + start + '-' + end + '/' + stat.size)
        .header('Content-Length', String(end - start + 1))
        .header('Cache-Control', 'public, max-age=60');
      return reply.send(fs.createReadStream(abs, { start, end }));
    }
    reply
      .type(mime)
      .header('Accept-Ranges', 'bytes')
      .header('Cache-Control', 'public, max-age=60')
      .header('Content-Length', String(stat.size));
    return reply.send(fs.createReadStream(abs));
  });

  app.post('/projects/:id/assets', async (req, reply) => {
    const projectId = Number((req.params as { id: string }).id);
    const q = req.query as { filename?: string; type?: string; source?: string; duration?: string };
    const body = req.body;
    let buffer: Buffer | null = null;
    let filename = q.filename ?? 'upload.bin';

    if (Buffer.isBuffer(body)) {
      buffer = body;
    } else if (body && typeof body === 'object') {
      const payload = body as { filename?: string; data_base64?: string; data_url?: string };
      filename = payload.filename ?? filename;
      const b64 = payload.data_url ?? payload.data_base64;
      if (b64) buffer = Buffer.from(String(b64).replace(/^data:[^;]+;base64,/, ''), 'base64');
    }
    if (!buffer) throw badRequest('缺少文件内容（base64 或二进制体）');

    const ext = path.extname(filename) || '.bin';
    const isAudio = /\.(wav|mp3|m4a|flac)$/i.test(filename);
    const isImage = /\.(png|jpg|jpeg|webp|gif|svg)$/i.test(filename);
    const assetType = (q.type as 'image' | 'video' | 'audio' | 'subtitle' | 'text') ?? (isAudio ? 'audio' : isImage ? 'image' : 'text');
    const key = assetKey('projects', projectId, 'uploads', Date.now() + ext);
    putObject({ key, content: buffer });
    const asset = createAsset({
      project_id: projectId,
      asset_type: assetType,
      source: (q.source as 'upload') ?? 'upload',
      key,
      duration_sec: q.duration ? Number(q.duration) : null,
      meta: { filename, bytes: buffer.length, original_name: filename }
    });
    reply.status(201);
    return asset;
  });

  app.delete('/assets/:id', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const asset = findAsset(id);
    if (asset) {
      try { fs.unlinkSync(objectPath(asset.bucket, asset.object_key)); } catch { /* ignore */ }
      run('DELETE FROM asset WHERE id = ?', [id]);
    }
    return { ok: true };
  });

  app.get('/projects/:id/assets/list', async (req) => {
    const projectId = Number((req.params as { id: string }).id);
    const type = (req.query as { type?: string }).type;
    return listAssets(projectId, type);
  });
}
