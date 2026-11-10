/** 云端账号池：轮询 + 冷却 + 额度（第五章四件必须做对的事之一） */
import { all, get, nowIso, run } from '../db/index.js';
import type { AppConfig } from '../config.js';

export interface AccountRow {
  id: number;
  provider: string;
  account_name: string;
  secret_ref: string;
  quota_used: number;
  quota_limit: number | null;
  cooldown_until: string | null;
  enabled: number;
}

export function acquireAccount(provider: string): AccountRow | null {
  const now = nowIso();
  const rows = all<AccountRow>(
    'SELECT * FROM render_account WHERE provider = ? AND enabled = 1 ORDER BY quota_used ASC, id ASC',
    [provider]
  );
  for (const row of rows) {
    if (row.cooldown_until && row.cooldown_until > now) continue;
    if (row.quota_limit != null && row.quota_used >= row.quota_limit) continue;
    run('UPDATE render_account SET quota_used = quota_used + 1 WHERE id = ?', [row.id]);
    return row;
  }
  return null;
}

export function coolDown(accountId: number, ms: number): void {
  const until = new Date(Date.now() + ms).toISOString();
  run('UPDATE render_account SET cooldown_until = ? WHERE id = ?', [until, accountId]);
}

export function resetAccountQuota(accountId: number): void {
  run('UPDATE render_account SET quota_used = 0, cooldown_until = NULL WHERE id = ?', [accountId]);
}

export function accountPool(provider?: string): AccountRow[] {
  return provider
    ? all<AccountRow>('SELECT * FROM render_account WHERE provider = ? ORDER BY id', [provider])
    : all<AccountRow>('SELECT * FROM render_account ORDER BY provider, id');
}

export function poolHealth(cfg: AppConfig, provider = 'muse'): { total: number; cooling: number; exhausted: number } {
  const rows = accountPool(provider);
  const now = nowIso();
  return {
    total: rows.length,
    cooling: rows.filter((r) => r.cooldown_until && r.cooldown_until > now).length,
    exhausted: rows.filter((r) => r.quota_limit != null && r.quota_used >= r.quota_limit).length
  };
}

/** 全局 QPS 限流（MUSE_QPS） */
const hits: number[] = [];
export function allowQps(qps: number): boolean {
  const now = Date.now();
  while (hits.length && now - hits[0] > 1000) hits.shift();
  if (hits.length >= qps) return false;
  hits.push(now);
  return true;
}
