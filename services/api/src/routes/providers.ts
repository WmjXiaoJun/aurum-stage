import type { FastifyInstance } from 'fastify';
import { museHealth } from '../adapters/muse.js';
import { accountPool } from '../adapters/accounts.js';
import {
  comfySimulate, comfyUrl, museConfig, readMuseSettings, setSetting, SETTING_KEYS
} from '../domain/settings-service.js';

export async function registerProviderRoutes(app: FastifyInstance): Promise<void> {
  /** 云端视频（APIMart / Muse 通道）当前配置与连通性 */
  app.get('/providers/muse', async () => {
    const cfg = museConfig();
    return {
      ...readMuseSettings(),
      accounts: accountPool('muse').map((a) => ({ id: a.id, name: a.account_name, quota_used: a.quota_used, quota_limit: a.quota_limit, enabled: Boolean(a.enabled), cooldown_until: a.cooldown_until })),
      simulate_fallback: !cfg.apiKey,
      models: ['muse-video-ext', 'MiniMax-H3-Max', 'MiniMax-H3', 'seedance-1-5-pro', 'seedance-2.0', 'VEO3']
    };
  });

  /** 保存 APIMart Key / 模型 / 分辨率（Key 只落中台 app_setting，前端回显掩码） */
  app.put('/providers/muse', async (req) => {
    const body = (req.body ?? {}) as { api_key?: string; base_url?: string; model?: string; resolution?: string; clear_key?: boolean };
    if (body.clear_key) setSetting(SETTING_KEYS.museApiKey, null);
    else if (body.api_key != null && body.api_key !== '') setSetting(SETTING_KEYS.museApiKey, body.api_key);
    if (body.base_url) setSetting(SETTING_KEYS.museBaseUrl, body.base_url);
    if (body.model) setSetting(SETTING_KEYS.museModel, body.model);
    if (body.resolution) setSetting(SETTING_KEYS.museResolution, body.resolution);
    return readMuseSettings();
  });

  app.post('/providers/muse/health', async () => museHealth());

  app.get('/providers/comfy', async () => ({ base_url: comfyUrl(), simulate: comfySimulate() }));

  app.put('/providers/comfy', async (req) => {
    const body = (req.body ?? {}) as { base_url?: string; simulate?: boolean };
    if (body.base_url) setSetting(SETTING_KEYS.comfyUrl, body.base_url.replace(/\/$/, ''));
    if (body.simulate != null) setSetting(SETTING_KEYS.comfySimulate, body.simulate ? 'true' : 'false');
    return { base_url: comfyUrl(), simulate: comfySimulate() };
  });
}
