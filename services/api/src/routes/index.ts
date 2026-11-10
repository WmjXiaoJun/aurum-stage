import type { FastifyInstance } from 'fastify';
import { registerMetaRoutes } from './meta.js';
import { registerProjectRoutes } from './projects.js';
import { registerScriptRoutes } from './scripts.js';
import { registerShotRoutes } from './shots.js';
import { registerAssetRoutes } from './assets.js';
import { registerCharacterRoutes } from './characters.js';
import { registerVoiceRoutes } from './voices.js';
import { registerTemplateRoutes } from './templates.js';
import { registerEngineeringRoutes } from './engineering.js';
import { registerSkillRoutes } from './skills.js';
import { registerEpisodeRoutes } from './episodes.js';
import { registerTaskRoutes } from './tasks.js';
import { registerNodeRoutes } from './nodes.js';
import { registerAgentRoutes } from './agents.js';
import { registerLlmRoutes } from './llm.js';
import { registerStyleRoutes } from './styles.js';
import { registerWsRoutes } from './ws.js';
import { registerComfyRoutes } from './comfy.js';
import { registerProviderRoutes } from './providers.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(async (scope) => {
    await registerMetaRoutes(scope);
    await registerProjectRoutes(scope);
    await registerScriptRoutes(scope);
    await registerShotRoutes(scope);
    await registerAssetRoutes(scope);
    await registerCharacterRoutes(scope);
    await registerVoiceRoutes(scope);
    await registerTemplateRoutes(scope);
  await registerEngineeringRoutes(scope);
  await registerSkillRoutes(scope);
  await registerEpisodeRoutes(scope);
    await registerTaskRoutes(scope);
    await registerNodeRoutes(scope);
    await registerAgentRoutes(scope);
    await registerLlmRoutes(scope);
    await registerStyleRoutes(scope);
    await registerComfyRoutes(scope);
    await registerProviderRoutes(scope);
    await registerWsRoutes(scope);
  }, { prefix: '/api/v1' });
}
