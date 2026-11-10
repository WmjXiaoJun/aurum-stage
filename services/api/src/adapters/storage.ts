/**
 * 素材存储（对象存储抽象）。
 * 默认本地文件系统落地，路径约定见附录 F；生产替换为 MinIO 只需实现同一接口。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Asset } from '@aurum/core';
import { config, ensureDirs } from '../config.js';
import { all, get, jstr, nowIso, run } from '../db/index.js';
import { mapAsset } from '../domain/mappers.js';
import { notFound } from '../http/errors.js';

export interface PutInput {
  bucket?: string;
  key: string;
  content: Buffer | string;
}

export function putObject(input: PutInput): { key: string; absPath: string; bytes: number } {
  ensureDirs();
  const bucket = input.bucket ?? 'assets';
  const absPath = path.join(config.storageDir, bucket, input.key);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const content = typeof input.content === 'string' ? Buffer.from(input.content, 'utf8') : input.content;
  fs.writeFileSync(absPath, content);
  return { key: input.key, absPath, bytes: content.length };
}

export function objectPath(bucket: string, key: string): string {
  return path.join(config.storageDir, bucket, key);
}

export function assetAbsPath(asset: Asset): string {
  return objectPath(asset.bucket, asset.object_key);
}

export interface CreateAssetInput {
  project_id: number;
  asset_type: Asset['asset_type'];
  source: Asset['source'];
  key: string;
  bucket?: string;
  width?: number | null;
  height?: number | null;
  duration_sec?: number | null;
  meta?: Record<string, unknown>;
  thumb_key?: string | null;
}

export function createAsset(input: CreateAssetInput): Asset {
  const res = run(
    'INSERT INTO asset (project_id, asset_type, source, bucket, object_key, nfs_path, thumb_key, width, height, duration_sec, meta, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    [
      input.project_id, input.asset_type, input.source, input.bucket ?? 'assets', input.key, null, input.thumb_key ?? null,
      input.width ?? null, input.height ?? null, input.duration_sec ?? null, jstr(input.meta ?? {}), nowIso()
    ]
  );
  return getAsset(res.lastInsertRowid);
}

export function getAsset(id: number): Asset {
  const row = get('SELECT * FROM asset WHERE id = ?', [id]);
  if (!row) throw notFound('素材不存在：' + id);
  return mapAsset(row);
}

export function findAsset(id: number): Asset | null {
  const row = get('SELECT * FROM asset WHERE id = ?', [id]);
  return row ? mapAsset(row) : null;
}

export function listAssets(projectId: number, type?: string): Asset[] {
  const rows = type
    ? all('SELECT * FROM asset WHERE project_id = ? AND asset_type = ? ORDER BY created_at DESC', [projectId, type])
    : all('SELECT * FROM asset WHERE project_id = ? ORDER BY created_at DESC', [projectId]);
  return rows.map(mapAsset);
}

export function assetKey(...parts: Array<string | number>): string {
  return parts.join('/').replace(/\/{2,}/g, '/');
}

export function safeExt(name: string): string {
  const ext = path.extname(name).toLowerCase();
  return ext && ext.length <= 6 ? ext : '.bin';
}
