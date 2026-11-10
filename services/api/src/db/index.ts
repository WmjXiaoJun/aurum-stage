import { DatabaseSync } from 'node:sqlite';
import { config, ensureDirs } from '../config.js';
import { logger } from '../logger.js';
import { SCHEMA_SQL } from './schema.js';

let db: DatabaseSync | null = null;

export function nowIso(): string {
  return new Date().toISOString();
}

const PATCH_COLUMNS: Array<{ table: string; column: string; ddl: string }> = [
  { table: 'round_shot', column: 'target_duration_ms', ddl: 'ALTER TABLE round_shot ADD COLUMN target_duration_ms INTEGER' },
  { table: 'project', column: 'visual_style', ddl: "ALTER TABLE project ADD COLUMN visual_style TEXT NOT NULL DEFAULT 'photoreal'" },
  { table: 'project', column: 'style_ref_asset_id', ddl: 'ALTER TABLE project ADD COLUMN style_ref_asset_id INTEGER' },
  { table: 'segment', column: 'visual_style', ddl: 'ALTER TABLE segment ADD COLUMN visual_style TEXT' },
  { table: 'round_shot', column: 'shot_code', ddl: "ALTER TABLE round_shot ADD COLUMN shot_code TEXT NOT NULL DEFAULT ''" },
  { table: 'round_shot', column: 'visual_style', ddl: "ALTER TABLE round_shot ADD COLUMN visual_style TEXT NOT NULL DEFAULT 'photoreal'" },
 { table: 'project', column: 'language', ddl: "ALTER TABLE project ADD COLUMN language TEXT NOT NULL DEFAULT 'zh'" },
 { table: 'round_shot', column: 'text_local', ddl: 'ALTER TABLE round_shot ADD COLUMN text_local TEXT' },
 { table: 'round_shot', column: 'lang', ddl: "ALTER TABLE round_shot ADD COLUMN lang TEXT" },
  { table: 'segment', column: 'episode_id', ddl: 'ALTER TABLE segment ADD COLUMN episode_id INTEGER' },
  { table: 'character_asset', column: 'art_status', ddl: "ALTER TABLE character_asset ADD COLUMN art_status TEXT NOT NULL DEFAULT 'none'" },
  { table: 'voice_asset', column: 'instruction', ddl: 'ALTER TABLE voice_asset ADD COLUMN instruction TEXT' },
  { table: 'project', column: 'auto_compose', ddl: "ALTER TABLE project ADD COLUMN auto_compose INTEGER NOT NULL DEFAULT 0" }
];

function applyPatches(): void {
  for (const patch of PATCH_COLUMNS) {
    try {
      const cols = db!.prepare('PRAGMA table_info(' + patch.table + ')').all() as Array<{ name: string }>;
      if (!cols.some((c) => c.name === patch.column)) {
        db!.exec(patch.ddl);
        logger.info('数据库补列：' + patch.table + '.' + patch.column, { service: 'api' });
      }
    } catch (err) {
      logger.warn('补列失败 ' + patch.table + '.' + patch.column + '：' + String(err), { service: 'api' });
    }
  }
}

export function getDb(): DatabaseSync {
  if (db) return db;
  ensureDirs();
  db = new DatabaseSync(config.dbFile);
  db.exec(SCHEMA_SQL);
  applyPatches();
  logger.info('数据库已就绪', { service: 'api', db: config.dbFile });
  return db;
}

export function all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
  const stmt = getDb().prepare(sql);
  return stmt.all(...(params as never[])) as T[];
}

export function get<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | undefined {
  const stmt = getDb().prepare(sql);
  return stmt.get(...(params as never[])) as T | undefined;
}

export function run(sql: string, params: unknown[] = []): { changes: number; lastInsertRowid: number } {
  const stmt = getDb().prepare(sql);
  const res = stmt.run(...(params as never[]));
  return { changes: Number(res.changes ?? 0), lastInsertRowid: Number(res.lastInsertRowid ?? 0) };
}

export function exec(sql: string): void {
  getDb().exec(sql);
}

export function tx<T>(fn: () => T): T {
  const conn = getDb();
  conn.exec('BEGIN');
  try {
    const out = fn();
    conn.exec('COMMIT');
    return out;
  } catch (e) {
    try { conn.exec('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  }
}

export function json<T>(raw: unknown, fallback: T): T {
  if (raw == null) return fallback;
  if (typeof raw === 'object') return raw as T;
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return fallback;
  }
}

export function jstr(v: unknown): string {
  return JSON.stringify(v ?? null);
}

export function bool(v: unknown): boolean {
  return v === 1 || v === true || v === '1' || v === 'true';
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
