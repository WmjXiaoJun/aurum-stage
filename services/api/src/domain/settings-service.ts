/** 运行期可改设置（app_setting 键值表）：云端视频密钥/模型、ComfyUI 地址等。
 *  密钥只存中台、日志脱敏、前端仅回显掩码。
 */
import { get, nowIso, run } from '../db/index.js';
import { config } from '../config.js';

export const SETTING_KEYS = {
  museApiKey: 'muse.api_key',
  museBaseUrl: 'muse.base_url',
  museModel: 'muse.model',
  museResolution: 'muse.resolution',
  comfyUrl: 'comfy.base_url',
  comfyTemplate: 'comfy.template_key',
  comfySimulate: 'comfy.simulate'
} as const;

export function getSetting(key: string): string | null {
  const row = get<{ value: string }>('SELECT value FROM app_setting WHERE key = ?', [key]);
  return row ? String(row.value) : null;
}

export function setSetting(key: string, value: string | null): void {
  if (value == null) {
    run('DELETE FROM app_setting WHERE key = ?', [key]);
    return;
  }
  run('INSERT INTO app_setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
}

/** 文本模型密钥：优先取 llm_provider 里配置的 key，回退环境变量 */
export function deepseekKey(): string {
  const row = get<{ api_keys: string }>("SELECT api_keys FROM llm_provider WHERE provider_key = 'deepseek' ORDER BY id LIMIT 1");
  try {
    const keys = row ? (JSON.parse(String(row.api_keys)) as string[]) : [];
    if (keys.length > 0) return keys[0];
  } catch { /* ignore */ }
  return config.llm.deepseekKey;
}

export function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '****' + key.slice(-4);
}

export interface MuseSettings {
  base_url: string;
  submit_path: string;
  task_path: string;
  model: string;
  resolution: string;
  api_key_set: boolean;
  api_key_masked: string;
}

export function museConfig(): { baseUrl: string; apiKey: string; model: string; resolution: string; submitPath: string; taskPath: string; pollMs: number; timeoutMs: number } {
  const apiKey = getSetting(SETTING_KEYS.museApiKey) ?? config.muse.apiKey;
  return {
    baseUrl: (getSetting(SETTING_KEYS.museBaseUrl) ?? config.muse.baseUrl).replace(/\/$/, ''),
    apiKey,
    model: getSetting(SETTING_KEYS.museModel) ?? config.muse.model,
    resolution: getSetting(SETTING_KEYS.museResolution) ?? config.muse.resolution,
    submitPath: config.muse.submitPath,
    taskPath: config.muse.taskPath,
    pollMs: config.muse.pollMs,
    timeoutMs: config.muse.timeoutMs
  };
}

export function readMuseSettings(): MuseSettings {
  const cfg = museConfig();
  return {
    base_url: cfg.baseUrl,
    submit_path: cfg.submitPath,
    task_path: cfg.taskPath,
    model: cfg.model,
    resolution: cfg.resolution,
    api_key_set: Boolean(cfg.apiKey),
    api_key_masked: maskKey(cfg.apiKey)
  };
}

export function comfyUrl(): string {
  return (getSetting(SETTING_KEYS.comfyUrl) ?? config.comfy.baseUrl).replace(/\/$/, '');
}

/** 本地探测后写入的默认工作流（仅当探测到视频节点时才会设置，避免把视频镜头跑成静帧） */
export function comfyDefaultTemplate(): string | null {
  return getSetting(SETTING_KEYS.comfyTemplate);
}

/** 是否走真实本地 ComfyUI（true = 用代理片兜底）；可由设置页/探测动作切换 */
export function comfySimulate(): boolean {
  const raw = getSetting(SETTING_KEYS.comfySimulate);
  if (raw == null) return config.comfy.simulate;
  return raw !== 'false';
}

export { nowIso };
