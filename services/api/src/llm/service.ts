/** 供应商/模型/用量/故障切换（26.4） */
import { all, get, jstr, json, nowIso, run } from '../db/index.js';
import { ApiError, notFound } from '../http/errors.js';
import { logger } from '../logger.js';
import { buildHttpBackend, parseJsonLoose } from './backends.js';
import type { ChatMessage, ChatOptions, ChatResult, ModelInfo, ProviderRow, TextBackend } from './types.js';

function rowToProvider(row: Record<string, unknown>): ProviderRow {
  return {
    id: Number(row.id),
    provider_key: String(row.provider_key),
    display_name: String(row.display_name),
    protocol: String(row.protocol),
    base_url: String(row.base_url),
    api_keys: json<string[]>(row.api_keys, []),
    enabled: (Number(row.enabled) ? 1 : 0) as 0 | 1,
    is_default: (Number(row.is_default) ? 1 : 0) as 0 | 1,
    health: String(row.health ?? 'unknown'),
    last_check: row.last_check == null ? null : String(row.last_check),
    meta: json<Record<string, unknown>>(row.meta, {})
  };
}

export function listProviders(): Array<ProviderRow & { models: ModelInfo[] }> {
  const rows = all('SELECT * FROM llm_provider ORDER BY is_default DESC, id ASC');
  return rows.map((row) => {
    const provider = rowToProvider(row);
    const models = all<{ model_id: string; display_name: string | null; capabilities: string; context_len: number | null }>(
      'SELECT * FROM llm_model WHERE provider_id = ? AND enabled = 1 ORDER BY model_id',
      [provider.id]
    ).map((m) => ({
      model_id: m.model_id,
      display_name: m.display_name ?? m.model_id,
      capabilities: json<string[]>(m.capabilities, []),
      context_len: m.context_len ?? undefined
    }));
    return { ...provider, models };
  });
}

export interface ProviderInput {
  provider_key: string;
  display_name?: string;
  protocol?: string;
  base_url: string;
  api_keys?: string[];
  enabled?: boolean;
  is_default?: boolean;
  meta?: Record<string, unknown>;
}

export function upsertProvider(input: ProviderInput): ProviderRow {
  const existing = get('SELECT * FROM llm_provider WHERE provider_key = ?', [input.provider_key]);
  const now = nowIso();
  if (existing) {
    run('UPDATE llm_provider SET display_name = ?, protocol = ?, base_url = ?, api_keys = ?, enabled = ?, is_default = ?, meta = ? WHERE id = ?', [
      input.display_name ?? String(existing.display_name),
      input.protocol ?? String(existing.protocol),
      input.base_url ?? String(existing.base_url),
      jstr(input.api_keys ?? json<string[]>(existing.api_keys, [])),
      input.enabled == null ? Number(existing.enabled) : (input.enabled ? 1 : 0),
      input.is_default == null ? Number(existing.is_default) : (input.is_default ? 1 : 0),
      jstr(input.meta ?? json<Record<string, unknown>>(existing.meta, {})),
      Number(existing.id)
    ]);
    if (input.is_default) run('UPDATE llm_provider SET is_default = 0 WHERE id <> ?', [Number(existing.id)]);
    return rowToProvider(get('SELECT * FROM llm_provider WHERE id = ?', [Number(existing.id)]) as Record<string, unknown>);
  }
  const res = run(
    'INSERT INTO llm_provider (provider_key, display_name, protocol, base_url, api_keys, enabled, is_default, health, meta, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [
      input.provider_key,
      input.display_name ?? input.provider_key,
      input.protocol ?? 'openai',
      input.base_url,
      jstr(input.api_keys ?? []),
      input.enabled === false ? 0 : 1,
      input.is_default ? 1 : 0,
      'unknown',
      jstr(input.meta ?? {}),
      now
    ]
  );
  if (input.is_default) run('UPDATE llm_provider SET is_default = 0 WHERE id <> ?', [res.lastInsertRowid]);
  return rowToProvider(get('SELECT * FROM llm_provider WHERE id = ?', [res.lastInsertRowid]) as Record<string, unknown>);
}

export function deleteProvider(id: number): void {
  run('DELETE FROM llm_provider WHERE id = ?', [id]);
}

export function getProvider(idOrKey: number | string): ProviderRow {
  const row = typeof idOrKey === 'number'
    ? get('SELECT * FROM llm_provider WHERE id = ?', [idOrKey])
    : get('SELECT * FROM llm_provider WHERE provider_key = ?', [idOrKey]);
  if (!row) throw notFound('供应商不存在');
  return rowToProvider(row);
}

export function defaultProvider(): ProviderRow | null {
  const row = get('SELECT * FROM llm_provider WHERE enabled = 1 ORDER BY is_default DESC, id ASC LIMIT 1');
  return row ? rowToProvider(row) : null;
}

function defaultModelOf(provider: ProviderRow): string {
  const row = get<{ model_id: string }>('SELECT model_id FROM llm_model WHERE provider_id = ? AND enabled = 1 ORDER BY id ASC LIMIT 1', [provider.id]);
  if (row) return row.model_id;
  const meta = provider.meta as { default_model?: string };
  return String(meta.default_model ?? 'gpt-4o-mini');
}

/** 模型自动发现（/v1/models）并按名称推断能力 */
export async function discoverModels(providerId: number): Promise<ModelInfo[]> {
  const provider = getProvider(providerId);
  const backend = buildHttpBackend(provider, defaultModelOf(provider));
  const models = await backend.listModels();
  run('DELETE FROM llm_model WHERE provider_id = ? AND discovered = 1', [provider.id]);
  for (const m of models) {
    run('INSERT OR IGNORE INTO llm_model (provider_id, model_id, display_name, capabilities, enabled, discovered) VALUES (?,?,?,?,1,1)', [
      provider.id, m.model_id, m.display_name ?? m.model_id, jstr(m.capabilities)
    ]);
  }
  run('UPDATE llm_provider SET health = ?, last_check = ? WHERE id = ?', [models.length ? 'ok' : 'degraded', nowIso(), provider.id]);
  return models;
}

export async function checkHealth(providerId: number): Promise<{ ok: boolean; detail: string }> {
  const provider = getProvider(providerId);
  const backend = buildHttpBackend(provider, defaultModelOf(provider));
  const res = await backend.health();
  run('UPDATE llm_provider SET health = ?, last_check = ? WHERE id = ?', [res.ok ? 'ok' : 'down', nowIso(), provider.id]);
  return res;
}

export interface ResolvedBackend {
  backend: TextBackend;
  provider: ProviderRow;
  model: string;
  project_override: boolean;
}

/** 选择优先级：项目级 > 全局默认；失败按健康度轮换下一个供应商 */
export function resolveBackend(projectId?: number): ResolvedBackend | null {
  if (projectId) {
    const override = get('SELECT * FROM project_llm_override WHERE project_id = ?', [projectId]);
    if (override && override.provider_id != null) {
      try {
        const provider = getProvider(Number(override.provider_id));
        const model = String(override.model_id ?? defaultModelOf(provider));
        return { backend: buildHttpBackend(provider, model), provider, model, project_override: true };
      } catch {
        /* 覆盖失效，回退默认 */
      }
    }
  }
  const provider = defaultProvider();
  if (!provider) return null;
  const model = defaultModelOf(provider);
  return { backend: buildHttpBackend(provider, model), provider, model, project_override: false };
}

export function resolveBackendFor(providerKey: string, model?: string): ResolvedBackend | null {
  const provider = getProvider(providerKey);
  return { backend: buildHttpBackend(provider, model ?? defaultModelOf(provider)), provider, model: model ?? defaultModelOf(provider), project_override: false };
}

export function logUsage(input: { provider: string; model: string; purpose?: string; tokens_in?: number; tokens_out?: number; latency_ms?: number; ok?: boolean }): void {
  run('INSERT INTO llm_usage (provider, model, purpose, tokens_in, tokens_out, latency_ms, ok, created_at) VALUES (?,?,?,?,?,?,?,?)', [
    input.provider, input.model, input.purpose ?? null, input.tokens_in ?? 0, input.tokens_out ?? 0, input.latency_ms ?? 0, input.ok === false ? 0 : 1, nowIso()
  ]);
}

export function usageSummary(days = 7): Array<Record<string, unknown>> {
  return all(
    'SELECT provider, model, COUNT(*) AS calls, SUM(tokens_in) AS tokens_in, SUM(tokens_out) AS tokens_out, AVG(latency_ms) AS avg_latency FROM llm_usage WHERE created_at >= ? GROUP BY provider, model ORDER BY calls DESC',
    [new Date(Date.now() - days * 86400_000).toISOString()]
  );
}

export interface StructuredCallOptions {
  messages: ChatMessage[];
  schema: Record<string, unknown>;
  purpose: string;
  project_id?: number;
  temperature?: number;
  provider_key?: string;
  model?: string;
}

/** 统一结构化调用：项目覆盖 → 默认 → 失败切备用供应商 */
export async function callStructured<T>(opts: StructuredCallOptions): Promise<{ data: T; chat: ChatResult; provider: string; model: string }> {
  const chain: Array<ResolvedBackend | null> = [];
  if (opts.provider_key) chain.push(resolveBackendFor(opts.provider_key, opts.model));
  chain.push(resolveBackend(opts.project_id));
  for (const p of listProviders()) {
    if (p.enabled) chain.push({ backend: buildHttpBackend(p, p.models[0]?.model_id ?? defaultModelOf(p)), provider: p, model: p.models[0]?.model_id ?? defaultModelOf(p), project_override: false });
  }
  const seen = new Set<string>();
  let lastErr: unknown = null;
  for (const entry of chain) {
    if (!entry) continue;
    const sig = entry.provider.provider_key + '|' + entry.model;
    if (seen.has(sig)) continue;
    seen.add(sig);
    try {
      const options: ChatOptions = { temperature: opts.temperature ?? 0.6 };
      const { data, chat } = await entry.backend.structured<T>(opts.schema, opts.messages, options);
      logUsage({
        provider: entry.provider.provider_key,
        model: entry.model,
        purpose: opts.purpose,
        tokens_in: chat.usage?.prompt_tokens,
        tokens_out: chat.usage?.completion_tokens,
        latency_ms: chat.latency_ms,
        ok: true
      });
      run('UPDATE llm_provider SET health = ?, last_check = ? WHERE id = ?', ['ok', nowIso(), entry.provider.id]);
      return { data, chat, provider: entry.provider.provider_key, model: entry.model };
    } catch (err) {
      lastErr = err;
      logger.warn('LLM 调用失败，切换下一个供应商：' + String((err as Error).message).slice(0, 120), { service: 'llm' });
      run('UPDATE llm_provider SET health = ?, last_check = ? WHERE id = ?', ['down', nowIso(), entry.provider.id]);
      logUsage({ provider: entry.provider.provider_key, model: entry.model, purpose: opts.purpose, ok: false });
    }
  }
  throw new ApiError('LLM_UNAVAILABLE', '所有文本后端均不可用：' + String((lastErr as Error)?.message ?? '').slice(0, 160));
}

export function setProjectOverride(projectId: number, input: { provider_id?: number | null; model_id?: string | null; params?: Record<string, unknown> }): void {
  run('INSERT INTO project_llm_override (project_id, provider_id, model_id, params, updated_at) VALUES (?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET provider_id = excluded.provider_id, model_id = excluded.model_id, params = excluded.params, updated_at = excluded.updated_at', [
    projectId, input.provider_id ?? null, input.model_id ?? null, jstr(input.params ?? {}), nowIso()
  ]);
}

export function getProjectOverride(projectId: number): Record<string, unknown> | null {
  const row = get('SELECT * FROM project_llm_override WHERE project_id = ?', [projectId]);
  return row ? (row as Record<string, unknown>) : null;
}

export { parseJsonLoose };
