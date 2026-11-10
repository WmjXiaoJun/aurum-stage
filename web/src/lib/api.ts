/** 后端 API 客户端：统一错误信封解析 + 类型化调用 */
const BASE = '/api/v1';

export interface ApiErrorPayload {
  code: string;
  message: string;
  ui_hint: string;
  retry: string;
  details: Record<string, unknown> | null;
}

export class ApiError extends Error {
  code: string;
  uiHint: string;
  retry: string;
  details: Record<string, unknown> | null;
  status: number;

  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.message);
    this.status = status;
    this.code = payload.code;
    this.uiHint = payload.ui_hint;
    this.retry = payload.retry;
    this.details = payload.details;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      ...(init.body && typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {})
    }
  });
  const text = await res.text();
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  if (!res.ok) {
    const payload = (parsed as { error?: ApiErrorPayload })?.error;
    if (payload?.code) throw new ApiError(res.status, payload);
    throw new ApiError(res.status, { code: 'NETWORK', message: String(parsed ?? res.statusText), ui_hint: '稍后重试', retry: 'none', details: null });
  }
  return parsed as T;
}

const qs = (params: Record<string, string | number | undefined | null>): string => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return entries.length ? '?' + entries.map(([k, v]) => k + '=' + encodeURIComponent(String(v))).join('&') : '';
};

export const api = {
  meta: () => request<import('./types').Meta>('/meta'),
  health: () => request<{ ok: boolean; ffmpeg: string | null }>('/health'),

  // projects
  listProjects: () => request<import('./types').Project[]>('/projects'),
  getProject: (id: number) => request<import('./types').Project>('/projects/' + id),
  createProject: (body: Record<string, unknown>) => request<import('./types').Project>('/projects', { method: 'POST', body: JSON.stringify(body) }),
  patchProject: (id: number, body: Record<string, unknown>) => request<import('./types').Project>('/projects/' + id, { method: 'PATCH', body: JSON.stringify(body) }),
  localizeProject: (id: number, language: string) => request<{ language: string; translated: number; total: number }>('/projects/' + id + '/localize', { method: 'POST', body: JSON.stringify({ language }) }),
  restoreProjectLanguage: (id: number) => request<{ language: string; translated: number; total: number }>('/projects/' + id + '/localize', { method: 'DELETE' }),
  deleteProject: (id: number) => request<{ ok: boolean }>('/projects/' + id, { method: 'DELETE' }),
  overview: (id: number, episodeId?: number) => request<import('./types').Overview>('/projects/' + id + '/overview' + (episodeId ? '?episode_id=' + episodeId : '')),
  voicePresets: () => request<Array<{ id: string; label: string; instruction: string }>>('/voices'),
  episodes: (id: number) => request<Array<Record<string, unknown>>>('/projects/' + id + '/episodes'),
  board: () => request<Array<Record<string, unknown>>>('/board'),
  projectCovers: (id: number) => request<{ covers: string[] }>('/projects/' + id + '/covers'),
  segments: (id: number) => request<import('./types').Segment[]>('/projects/' + id + '/segments'),
  createSegment: (id: number, body: Record<string, unknown>) => request<import('./types').Segment>('/projects/' + id + '/segments', { method: 'POST', body: JSON.stringify(body) }),
  patchSegment: (segmentId: number, body: Record<string, unknown>) => request<import('./types').Segment>('/segments/' + segmentId, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteSegment: (segmentId: number) => request<{ ok: boolean }>('/segments/' + segmentId, { method: 'DELETE' }),
  compliance: (id: number) => request<{ cap_sec: number; items: import('./types').Compliance[] }>('/projects/' + id + '/compliance'),
  timeline: (id: number) => request<{ items: import('./types').TimelineItem[]; total_ms: number }>('/projects/' + id + '/timeline'),
  patchTimeline: (itemId: number, body: Record<string, unknown>) => request<import('./types').TimelineItem>('/timeline/' + itemId, { method: 'PATCH', body: JSON.stringify(body) }),
  splitTimeline: (itemId: number, atMs: number) => request<import('./types').TimelineItem[]>('/timeline/' + itemId + '/split', { method: 'POST', body: JSON.stringify({ at_ms: atMs }) }),
  duplicateTimeline: (itemId: number) => request<import('./types').TimelineItem>('/timeline/' + itemId + '/duplicate', { method: 'POST', body: '{}' }),
  deleteTimeline: (itemId: number) => request<{ ok: boolean }>('/timeline/' + itemId, { method: 'DELETE' }),
  rebuildTimeline: (projectId: number) => request<{ ok: boolean }>('/projects/' + projectId + '/timeline/rebuild', { method: 'POST', body: '{}' }),
  compose: (id: number, body: Record<string, unknown>) => request<{ mode: string; duration_sec: number; video_url: string | null; subtitle_url: string; ass_url: string; warnings: string[] }>('/projects/' + id + '/compose', { method: 'POST', body: JSON.stringify(body) }),
  exports: (id: number) => request<Array<Record<string, unknown>>>('/projects/' + id + '/exports'),
  issues: (id: number, resolved = 'open') => request<import('./types').Issue[]>('/projects/' + id + '/issues' + qs({ resolved })),
  patchIssue: (issueId: number, body: Record<string, unknown>) => request<import('./types').Issue>('/issues/' + issueId, { method: 'PATCH', body: JSON.stringify(body) }),
  clues: (id: number) => request<Array<Record<string, unknown>>>('/projects/' + id + '/clues'),
  createClue: (id: number, body: Record<string, unknown>) => request<Record<string, unknown>>('/projects/' + id + '/clues', { method: 'POST', body: JSON.stringify(body) }),
  assets: (id: number, type?: string) => request<import('./types').Asset[]>('/projects/' + id + '/assets' + qs({ type })),

  // script
  scripts: (id: number) => request<Array<{ id: number; version: number; parse_status: string; created_at: string }>>('/projects/' + id + '/scripts'),
  latestScript: (id: number) => request<{ id: number; raw_md: string; structured_json: Record<string, unknown>; parse_status: string; version: number }>('/projects/' + id + '/script/latest'),
  getScript: (scriptId: number) => request<{ script: { id: number; raw_md: string; structured_json: Record<string, unknown>; parse_status: string; parse_report: Record<string, unknown> | null; version: number }; shots: import('./types').Shot[]; compliance: import('./types').Compliance[] }>('/scripts/' + scriptId),
  saveScript: (id: number, raw_md: string) => request<{ id: number; version: number }>('/projects/' + id + '/scripts', { method: 'POST', body: JSON.stringify({ raw_md }) }),
  parseScript: (scriptId: number, body: Record<string, unknown> = {}) => request<{ script: unknown; report: Record<string, unknown>; compliance: import('./types').Compliance[]; created_characters: string[]; shots: import('./types').Shot[] }>('/scripts/' + scriptId + '/parse', { method: 'POST', body: JSON.stringify(body) }),
  parsePreview: (id: number, raw_md: string) => request<{ structured: Record<string, unknown>; report: Record<string, unknown>; estimated_segments: Array<{ title: string; segment_type: string; shots: number; estimate_ms: number }> }>('/projects/' + id + '/parse-preview', { method: 'POST', body: JSON.stringify({ raw_md }) }),

  // shots
  shots: (id: number, filter: Record<string, string | number | undefined> = {}) => request<import('./types').Shot[]>('/projects/' + id + '/shots' + qs(filter as never)),
  shot: (shotId: number) => request<{ shot: import('./types').Shot; tasks: import('./types').Task[]; audio_candidates: Array<Record<string, unknown>>; video_candidates: Array<Record<string, unknown>> }>('/shots/' + shotId),
  patchShot: (shotId: number, body: Record<string, unknown>) => request<import('./types').Shot>('/shots/' + shotId, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteShot: (shotId: number) => request<{ ok: boolean }>('/shots/' + shotId, { method: 'DELETE' }),
  createShot: (segmentId: number, body: Record<string, unknown>) => request<import('./types').Shot>('/segments/' + segmentId + '/shots', { method: 'POST', body: JSON.stringify(body) }),
  reorderShots: (segmentId: number, ordered_ids: number[]) => request<import('./types').Shot[]>('/segments/' + segmentId + '/reorder', { method: 'POST', body: JSON.stringify({ ordered_ids }) }),
  renderShot: (shotId: number, body: Record<string, unknown> = {}) => request<{ shot_id: number; task_dag: Array<{ task_id: number; type: string; status: string; depends_on: number[] }>; replays: number[] }>('/shots/' + shotId + '/render', { method: 'POST', body: JSON.stringify(body) }),
  ttsShot: (shotId: number, body: Record<string, unknown> = {}) => request<{ task_id: number; status: string }>('/shots/' + shotId + '/tts', { method: 'POST', body: JSON.stringify(body) }),
  shotAudio: (shotId: number) => request<Array<{ id: number; idx: number; state: string; duration_ms: number | null; url: string }>>('/shots/' + shotId + '/audio'),
  selectCandidate: (shotId: number, candidateId: number) => request<import('./types').Shot>('/shots/' + shotId + '/candidates/' + candidateId + '/select', { method: 'POST', body: '{}' }),
  lockShot: (shotId: number, locked: boolean) => request<import('./types').Shot>('/shots/' + shotId + '/lock', { method: 'POST', body: JSON.stringify({ locked }) }),
  renderAll: (id: number, body: Record<string, unknown> = {}) => request<{ submitted: number }>('/projects/' + id + '/render-all', { method: 'POST', body: JSON.stringify(body) }),

  // assets
  uploadAsset: (id: number, file: File, extra: Record<string, string> = {}) => new Promise<import('./types').Asset>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64 = String(reader.result).split(',')[1] ?? '';
        const asset = await request<import('./types').Asset>('/projects/' + id + '/assets' + qs({ filename: file.name, ...extra }), {
          method: 'POST',
          body: JSON.stringify({ filename: file.name, data_base64: base64 })
        });
        resolve(asset);
      } catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  }),

  // characters / voices
  characters: (id: number) => request<import('./types').Character[]>('/projects/' + id + '/characters'),
  characterLibrary: () => request<Array<Record<string, unknown>>>('/characters'),
  skills: () => request<Array<Record<string, unknown>>>('/skills'),
  projectSkills: (id: number) => request<Array<Record<string, unknown>>>('/projects/' + id + '/skills'),
  skillDoc: (id: number, key: string) => request<{ skill_key: string; version?: number; status?: string; body: Record<string, unknown> | null; gates: Array<Record<string, unknown>> }>('/projects/' + id + '/skills/' + key),
  runDevelopmentPack: (id: number, body: Record<string, unknown>) => request<{ ok: boolean; stopped_at: string | null; steps: Array<{ key: string; name: string; status: string; gates: Array<{ id: string; label: string; pass: boolean; detail: string }> }>; created?: { segments: number; shots: number; characters: number } }>('/projects/' + id + '/skills/development-pack', { method: 'POST', body: JSON.stringify(body) }),
  runSkill: (id: number, key: string, body: Record<string, unknown> = {}) => request<{ skill_key: string; version: number; status: string; gates: Array<{ id: string; pass: boolean }>; body: Record<string, unknown> }>('/projects/' + id + '/skills/' + key + '/run', { method: 'POST', body: JSON.stringify(body) }),
  applySkill: (id: number, key: string) => request<Record<string, unknown>>('/projects/' + id + '/skills/' + key + '/apply', { method: 'POST', body: '{}' }),
  engineering: (id: number) => request<{ version: number; status: string; body: Record<string, unknown>; history: Array<Record<string, unknown>> }>('/projects/' + id + '/engineering'),
  rebuildEngineering: (id: number, body: Record<string, unknown> = {}) => request<Record<string, unknown>>('/projects/' + id + '/engineering/rebuild', { method: 'POST', body: JSON.stringify(body) }),
  batchCloneEngineering: (id: number, body: Record<string, unknown>) => request<{ created: number[]; count: number }>('/projects/' + id + '/engineering/batch-clone', { method: 'POST', body: JSON.stringify(body) }),
  cloneEngineering: (id: number, body: Record<string, unknown>) => request<{ project_id: number; engineering: Record<string, unknown> }>('/projects/' + id + '/engineering/clone', { method: 'POST', body: JSON.stringify(body) }),
  abstractEngineering: (id: number) => request<{ template_key: string }>('/projects/' + id + '/engineering/abstract', { method: 'POST', body: '{}' }),
  instantiateTemplate: (key: string, body: Record<string, unknown>) => request<{ project_id: number }>('/templates/' + key + '/instantiate', { method: 'POST', body: JSON.stringify(body) }),
  applyTemplate: (key: string, body: Record<string, unknown>) => request<{ project_id: number; template_key: string; visual_style: string; aspect: string }>('/templates/' + key + '/apply', { method: 'POST', body: JSON.stringify(body) }),
  createCharacter: (id: number, body: Record<string, unknown>) => request<import('./types').Character>('/projects/' + id + '/characters', { method: 'POST', body: JSON.stringify(body) }),
  patchCharacter: (characterId: number, body: Record<string, unknown>) => request<import('./types').Character>('/characters/' + characterId, { method: 'PATCH', body: JSON.stringify(body) }),
  addRefImage: (characterId: number, asset_id: number, angle: string) => request<unknown>('/characters/' + characterId + '/ref-images', { method: 'POST', body: JSON.stringify({ asset_id, angle }) }),
  generateCharacterArt: (characterId: number, body: Record<string, unknown>) => request<{ assets: Array<{ id: number; url: string; kind: string }>; files: Record<string, Array<{ id: number; url: string; kind: string }>> }>('/characters/' + characterId + '/generate', { method: 'POST', body: JSON.stringify(body) }),
  characterFiles: (characterId: number) => request<Record<string, Array<{ id: number; url: string; kind: string }>>>('/characters/' + characterId + '/files'),
  autoCharacter: (id: number) => request<Record<string, unknown>>('/characters/' + id + '/auto', { method: 'POST', body: '{}' }),
  bindCharacterVoice: (characterId: number, body: Record<string, unknown>) => request<Record<string, unknown>>('/characters/' + characterId + '/voice', { method: 'POST', body: JSON.stringify(body) }),
  auditionCharacter: (characterId: number, body: Record<string, unknown>) => request<{ url: string; duration_ms: number; engine: string; text: string }>('/characters/' + characterId + '/audition', { method: 'POST', body: JSON.stringify(body) }),
  deleteRefImage: (characterId: number, refId: number) => request<{ ok: boolean }>('/characters/' + characterId + '/ref-images/' + refId, { method: 'DELETE' }),
  newCharacterVersion: (characterId: number) => request<import('./types').Character>('/characters/' + characterId + '/version', { method: 'POST', body: '{}' }),

  voices: (id: number) => request<import('./types').Voice[]>('/projects/' + id + '/voices'),
  createVoice: (id: number, body: Record<string, unknown>) => request<import('./types').Voice>('/projects/' + id + '/voices', { method: 'POST', body: JSON.stringify(body) }),
  patchVoice: (voiceId: number, body: Record<string, unknown>) => request<import('./types').Voice>('/voices/' + voiceId, { method: 'PATCH', body: JSON.stringify(body) }),
  addVoiceRef: (voiceId: number, body: Record<string, unknown>) => request<unknown>('/voices/' + voiceId + '/ref-audios', { method: 'POST', body: JSON.stringify(body) }),
  voiceHealth: (voiceId: number) => request<{ ok: boolean; issues: string[]; refs: number }>('/voices/' + voiceId + '/health'),

  // tasks
  tasks: (params: Record<string, string | number | undefined> = {}) => request<import('./types').Task[]>('/tasks' + qs(params)),
  retryTask: (taskId: number) => request<import('./types').Task>('/tasks/' + taskId + '/retry', { method: 'POST', body: '{}' }),
  cancelTask: (taskId: number) => request<import('./types').Task>('/tasks/' + taskId + '/cancel', { method: 'POST', body: '{}' }),
  schedulerStats: () => request<Record<string, unknown>>('/scheduler/stats'),
  tickScheduler: () => request<Record<string, unknown>>('/scheduler/tick', { method: 'POST', body: '{}' }),

  // nodes / templates
  nodes: () => request<Array<Record<string, unknown>>>('/nodes'),
  createNode: (body: Record<string, unknown>) => request<Record<string, unknown>>('/nodes', { method: 'POST', body: JSON.stringify(body) }),
  templates: (type?: string) => request<import('./types').Template[]>('/templates' + qs({ type })),
  createTemplate: (body: Record<string, unknown>) => request<import('./types').Template>('/templates', { method: 'POST', body: JSON.stringify(body) }),
  patchTemplate: (key: string, body: Record<string, unknown>) => request<import('./types').Template>('/templates/' + key, { method: 'PATCH', body: JSON.stringify(body) }),

  // agents
  agentRuns: (id: number) => request<import('./types').AgentRun[]>('/projects/' + id + '/agents/runs'),
  agentRun: (runId: number) => request<import('./types').AgentRun>('/agents/runs/' + runId),
  startAgentRun: (id: number, body: Record<string, unknown>) => request<import('./types').AgentRun>('/projects/' + id + '/agents/run', { method: 'POST', body: JSON.stringify(body) }),
  stepAgentRun: (runId: number) => request<import('./types').AgentRun>('/agents/runs/' + runId + '/step', { method: 'POST', body: '{}' }),
  confirmAgentStage: (runId: number, body: Record<string, unknown>) => request<import('./types').AgentRun>('/agents/runs/' + runId + '/confirm', { method: 'POST', body: JSON.stringify(body) }),
  applyAgentRun: (runId: number) => request<{ script_id: number; segments: number; shots: number }>('/agents/runs/' + runId + '/apply', { method: 'POST', body: '{}' }),
  agentStages: () => request<Array<{ stage: string; agent: string; label: string }>>('/agents/stages'),

  // llm
  llmProviders: () => request<import('./types').LlmProvider[]>('/llm/providers'),
  upsertLlmProvider: (body: Record<string, unknown>) => request<import('./types').LlmProvider>('/llm/providers', { method: 'POST', body: JSON.stringify(body) }),
  patchLlmProvider: (providerId: number, body: Record<string, unknown>) => request<import('./types').LlmProvider>('/llm/providers/' + providerId, { method: 'PATCH', body: JSON.stringify(body) }),
  discoverModels: (providerId: number) => request<{ count: number }>('/llm/providers/' + providerId + '/discover', { method: 'POST', body: '{}' }),
  llmUsage: () => request<Array<Record<string, unknown>>>('/llm/usage'),
  projectLlm: (id: number) => request<{ providers: import('./types').LlmProvider[]; override: Record<string, unknown> | null }>('/projects/' + id + '/llm'),
  setProjectLlm: (id: number, body: Record<string, unknown>) => request<Record<string, unknown>>('/projects/' + id + '/llm', { method: 'PUT', body: JSON.stringify(body) }),

  // 云端视频（APIMart）与本地 ComfyUI
  museProvider: () => request<import('./types').MuseProviderInfo>('/providers/muse'),
  saveMuseProvider: (body: Record<string, unknown>) => request<import('./types').MuseProviderInfo>('/providers/muse', { method: 'PUT', body: JSON.stringify(body) }),
  museHealth: () => request<{ ok: boolean; detail: string; base_url: string; model: string; key_set: boolean }>('/providers/muse/health', { method: 'POST', body: '{}' }),
  comfyStatus: () => request<{ base_url: string; reachable: boolean; stats?: Record<string, unknown>; error?: string }>('/comfy/status'),
  comfyProbe: (body: Record<string, unknown>) => request<import('./types').ComfyProbeReport>('/comfy/probe', { method: 'POST', body: JSON.stringify(body) }),
  comfyTestRun: (body: Record<string, unknown>) => request<{ prompt_id: string; template_key: string; base_url: string }>('/comfy/test-run', { method: 'POST', body: JSON.stringify(body) }),
  comfyHistory: (promptId: string) => request<{ status: string; images?: string[] }>('/comfy/history/' + promptId),

  // styles / comic
  styles: () => request<import('./types').Meta['styles']>('/styles'),
  setStyleRef: (id: number, asset_id: number) => request<Record<string, unknown>>('/projects/' + id + '/style-ref', { method: 'POST', body: JSON.stringify({ asset_id }) }),
  comicPanels: (id: number) => request<Array<Record<string, unknown>>>('/comic/panels?project_id=' + id),
  createComicPanel: (body: Record<string, unknown>) => request<Record<string, unknown>>('/comic/panels', { method: 'POST', body: JSON.stringify(body) }),
  deleteComicPanel: (id: number) => request<{ ok: boolean }>('/comic/panels/' + id, { method: 'DELETE' }),
  webtoon: (id: number) => request<{ panels: Array<Record<string, unknown>>; total_ratio: number }>('/comic/webtoon?project_id=' + id)
};

export type Api = typeof api;
