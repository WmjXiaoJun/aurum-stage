import path from 'node:path';
import fs from 'node:fs';

const env = process.env;

export interface AppConfig {
  port: number;
  host: string;
  dataDir: string;
  storageDir: string;
  exportDir: string;
  webDist: string;
  dbFile: string;
  agentToken: string;
  muse: {
    baseUrl: string;
    apiKey: string;
    model: string;
    submitPath: string;
    taskPath: string;
    pollMs: number;
    timeoutMs: number;
    resolution: string;
    qps: number;
    simulateLatencyMin: number;
    simulateLatencyMax: number;
    simulateFailureRate: number;
  };
  comfy: { simulate: boolean; baseUrl: string };
  llm: { deepseekKey: string; deepseekBase: string };
  tts: {
    workerUrl: string;
    concurrency: number;
    simulateLatency: number;
    real: boolean;
    python: string;
    voiceHost: string;
    voiceGuestFemale: string;
    voiceGuestMale: string;
    voiceNarrator: string;
  };
  lipsync: {
    enabled: boolean;
    trigger: 'close_up_only' | 'all_talking' | 'off';
    real: boolean;
    python: string;
    cwd: string;
    module: string;
  };
  render: { h3ConcurrencyPerNode: number; h3MaxAttempt: number; defaultCandidates: number };
  compose: { ffmpegPath: string | null; bgmVolumeDb: number };
  segmentCapSec: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  scheduler: { enabled: boolean; tickMs: number; maxParallel: number };
}

function bool(v: string | undefined, d: boolean): boolean {
  if (v == null) return d;
  return /^(1|true|yes|on)$/i.test(v);
}

const dataDir = path.resolve(env.AURUM_DATA_DIR ?? path.join(process.cwd(), '.data'));

export const config: AppConfig = {
  port: Number(env.AURUM_PORT ?? env.PORT ?? 8787),
  host: env.AURUM_HOST ?? '127.0.0.1',
  dataDir,
  storageDir: path.join(dataDir, 'storage'),
  exportDir: path.join(dataDir, 'exports'),
  webDist: path.resolve(env.AURUM_WEB_DIST ?? path.join(process.cwd(), '..', '..', 'web', 'dist')),
  dbFile: path.join(dataDir, 'aurum.db'),
  agentToken: env.AGENT_TOKEN ?? 'aurum-dev-agent-token',
  muse: {
    // APIMart：POST {base}/videos/generations → GET {base}/tasks/{task_id}
    baseUrl: env.MUSE_API_BASE ?? 'https://api.apimart.ai/v1',
    apiKey: env.MUSE_API_KEY ?? '',
    model: env.MUSE_MODEL ?? 'muse-video-ext',
    submitPath: env.MUSE_SUBMIT_PATH ?? '/videos/generations',
    taskPath: env.MUSE_TASK_PATH ?? '/tasks/{id}',
    pollMs: Number(env.MUSE_POLL_MS ?? 3000),
    timeoutMs: Number(env.MUSE_TIMEOUT_MS ?? 480000),
    resolution: env.MUSE_RESOLUTION ?? '720p',
    qps: Number(env.MUSE_QPS ?? 2),
    simulateLatencyMin: Number(env.MUSE_SIM_MIN_MS ?? 2600),
    simulateLatencyMax: Number(env.MUSE_SIM_MAX_MS ?? 7800),
    simulateFailureRate: Number(env.MUSE_SIM_FAIL_RATE ?? 0.05)
  },
  comfy: { simulate: bool(env.COMFY_SIMULATE, true), baseUrl: env.COMFYUI_URL ?? 'http://127.0.0.1:8188' },
  llm: {
    deepseekKey: env.DEEPSEEK_API_KEY ?? '',
    deepseekBase: env.DEEPSEEK_BASE ?? 'https://api.deepseek.com/v1'
  },
  tts: {
    workerUrl: env.TTS_WORKER_URL ?? 'http://127.0.0.1:9001',
    concurrency: Number(env.TTS_CONCURRENCY ?? 4),
    simulateLatency: Number(env.TTS_SIM_LATENCY_MS ?? 420),
    /** 真实中文配音：edge-tts（在线，音色自然）；失败自动回退本地合成占位 */
    real: bool(env.TTS_REAL, true),
    python: env.PYTHON_BIN ?? 'python',
    voiceHost: env.TTS_VOICE_HOST ?? 'zh-CN-YunxiNeural',
    voiceGuestFemale: env.TTS_VOICE_GUEST_F ?? 'zh-CN-XiaoxiaoNeural',
    voiceGuestMale: env.TTS_VOICE_GUEST_M ?? 'zh-CN-YunjianNeural',
    voiceNarrator: env.TTS_VOICE_NARRATOR ?? 'zh-CN-YunyangNeural'
  },
  lipsync: {
    enabled: bool(env.LIPSYNC_ENABLED, true),
    trigger: (env.LIPSYNC_TRIGGER as AppConfig['lipsync']['trigger']) ?? 'close_up_only',
    real: bool(env.LIPSYNC_REAL, true),
    python: env.LIPSYNC_PYTHON ?? 'D:\\BaiduSyncdisk\\wmj_work\\XJ\\AiJue\\local_models\\lipsync-venv\\Scripts\\python.exe',
    cwd: env.LIPSYNC_CWD ?? 'D:\\BaiduSyncdisk\\wmj_work\\XJ\\AiJue',
    module: env.LIPSYNC_MODULE ?? 'pipeline.lipsync'
  },
  render: {
    h3ConcurrencyPerNode: Number(env.H3_CONCURRENCY ?? 1),
    h3MaxAttempt: Number(env.H3_MAX_ATTEMPT ?? 2),
    defaultCandidates: Number(env.DEFAULT_CANDIDATES ?? 3)
  },
  compose: {
    ffmpegPath: env.FFMPEG_PATH ?? null,
    bgmVolumeDb: Number(env.BGM_VOLUME_DB ?? -18)
  },
  segmentCapSec: Number(env.SEGMENT_CAP_SEC ?? 300),
  logLevel: (env.AURUM_LOG_LEVEL as AppConfig['logLevel']) ?? 'info',
  scheduler: {
    enabled: bool(env.SCHEDULER_ENABLED, true),
    tickMs: Number(env.SCHEDULER_TICK_MS ?? 350),
    maxParallel: Number(env.SCHEDULER_MAX_PARALLEL ?? 4)
  }
};

export function ensureDirs(): void {
  for (const d of [config.dataDir, config.storageDir, config.exportDir, path.join(config.storageDir, 'thumbs')]) {
    fs.mkdirSync(d, { recursive: true });
  }
}
