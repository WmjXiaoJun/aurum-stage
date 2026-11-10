import type { FastifyInstance } from 'fastify';
import {
  PRODUCT,
  ABSTRACT_TO_PERFORMABLE,
  CAMERAS,
  CAMERA_LABEL,
  EMOTIONS,
  ENGINE_META,
  ERROR_CODES,
  RENDER_ENGINES,
  SEGMENT_CAP_SEC,
  SEGMENT_NEAR_SEC,
  SEGMENT_TYPES,
  SEGMENT_TYPE_LABEL,
  SHOT_STATUS_LABEL,
  SHOT_STATUSES,
  STYLE_LIST,
  TAG_CHEATSHEET,
  TASK_TYPE_LABEL,
  TASK_TYPES,
  TIMELINE_TRACKS,
  TIMELINE_TRACK_LABEL,
  VARIETY_TYPES,
  VARIETY_TYPE_LABEL,
  VISUAL_STYLES
} from '@aurum/core';
import { config } from '../config.js';
import { ffmpegPath } from '../media/ffmpeg.js';
import { poolHealth } from '../adapters/accounts.js';
import { getDb } from '../db/index.js';
import { comfyUrl, readMuseSettings } from '../domain/settings-service.js';
import { listProviders } from '../llm/service.js';

export async function registerMetaRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({
    ok: true,
    service: 'aurum-stage-api',
    version: '1.0.0',
    ts: new Date().toISOString(),
    ffmpeg: ffmpegPath(),
    database: config.dbFile
  }));

  app.get('/meta', async () => ({
    product: {
      name: PRODUCT.name,
      name_cn: PRODUCT.name_cn,
      name_en: PRODUCT.name_en,
      tagline: PRODUCT.tagline,
      version: PRODUCT.version,
      design: PRODUCT.design
    },
    constants: {
      segment_cap_sec: SEGMENT_CAP_SEC,
      segment_near_sec: SEGMENT_NEAR_SEC,
      variety_types: VARIETY_TYPES.map((v) => ({ id: v, label: VARIETY_TYPE_LABEL[v] })),
      engines: RENDER_ENGINES.map((e) => ({ id: e, ...ENGINE_META[e] })),
      cameras: CAMERAS.map((c) => ({ id: c, label: CAMERA_LABEL[c] })),
      segment_types: SEGMENT_TYPES.map((s) => ({ id: s, label: SEGMENT_TYPE_LABEL[s] })),
      shot_statuses: SHOT_STATUSES.map((s) => ({ id: s, label: SHOT_STATUS_LABEL[s] })),
      task_types: TASK_TYPES.map((t) => ({ id: t, label: TASK_TYPE_LABEL[t] })),
      timeline_tracks: TIMELINE_TRACKS.map((t) => ({ id: t, label: TIMELINE_TRACK_LABEL[t] })),
      visual_styles: VISUAL_STYLES
    },
    styles: STYLE_LIST,
    emotions: EMOTIONS,
    error_codes: Object.values(ERROR_CODES),
    tag_cheatsheet: TAG_CHEATSHEET,
    abstract_to_performable: ABSTRACT_TO_PERFORMABLE,
    runtime: {
      ffmpeg: ffmpegPath(),
      simulate: { comfy: config.comfy.simulate, muse_failure_rate: config.muse.simulateFailureRate },
      tts_worker: config.tts.workerUrl,
      lipsync: config.lipsync,
      scheduler: config.scheduler
    },
    accounts: { muse: poolHealth(config, 'muse') },
    providers: {
      muse: (() => {
        const s = readMuseSettings();
        return { base_url: s.base_url, model: s.model, resolution: s.resolution, api_key_set: s.api_key_set, api_key_masked: s.api_key_masked, submit_path: s.submit_path, task_path: s.task_path };
      })(),
      comfy: { base_url: comfyUrl() },
      text: listProviders().map((p) => ({ key: p.provider_key, name: p.display_name, enabled: Boolean(p.enabled), is_default: Boolean(p.is_default), models: p.models.map((m) => m.model_id) }))
    }
  }));

  app.get('/stats/overview', async () => {
    const db = getDb();
    void db;
    return { ok: true };
  });
}
