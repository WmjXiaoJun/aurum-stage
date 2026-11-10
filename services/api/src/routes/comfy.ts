import type { FastifyInstance } from 'fastify';
import { comfyTemplate, comfyTestRun, probeComfy } from '../adapters/comfy-probe.js';
import { comfyUrl } from '../domain/settings-service.js';
import { badRequest } from '../http/errors.js';
import { ffmpegPath } from '../media/ffmpeg.js';

export async function registerComfyRoutes(app: FastifyInstance): Promise<void> {
  app.get('/comfy/status', async () => {
    const base = comfyUrl();
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const res = await fetch(base + '/system_stats', { signal: ctrl.signal });
      clearTimeout(timer);
      const stats = res.ok ? await res.json() : null;
      return { base_url: base, reachable: res.ok, stats, ffmpeg: ffmpegPath() };
    } catch (err) {
      return { base_url: base, reachable: false, error: String((err as Error).message).slice(0, 200), ffmpeg: ffmpegPath() };
    }
  });

  /** 探测本机 ComfyUI，并按真实安装的模型自动生成模板 + 登记节点 */
  app.post('/comfy/probe', async (req) => {
    const body = (req.body ?? {}) as { base_url?: string; register?: boolean };
    return probeComfy({ base_url: body.base_url, register: body.register });
  });

  /** 用生成的模板向本地 ComfyUI 提交一次轻量试跑（8 步 / 512×512），返回 prompt_id */
  app.post('/comfy/test-run', async (req) => {
    const body = (req.body ?? {}) as { template_key?: string; prompt?: string; steps?: number; width?: number; height?: number };
    const key = body.template_key ?? 'comfy_local_image';
    const tpl = comfyTemplate(key);
    if (!tpl) throw badRequest('模板不存在，请先探测 ComfyUI：' + key);
    const workflow = JSON.parse(JSON.stringify(tpl.body)) as Record<string, { inputs?: Record<string, unknown> }>;
    const set = (node: string, field: string, value: unknown) => {
      const n = workflow[node];
      if (n?.inputs) n.inputs[field] = value;
    };
    set('6', 'text', body.prompt ?? '一位男主持人在演播厅微笑，暖色棚灯，中景，电影感');
    set('7', 'text', '畸形手指, 扭曲人脸, 多余肢体, 文字水印');
    set('3', 'steps', Math.max(4, Math.min(30, Number(body.steps ?? 8))));
    set('5', 'width', Math.max(256, Math.min(1536, Number(body.width ?? 512))));
    set('5', 'height', Math.max(256, Math.min(1536, Number(body.height ?? 512))));
    const result = await comfyTestRun(comfyUrl(), workflow);
    return { ...result, template_key: key, base_url: comfyUrl(), poll: '/api/v1/comfy/history/' + result.prompt_id };
  });

  app.get('/comfy/history/:promptId', async (req) => {
    const promptId = String((req.params as { promptId: string }).promptId);
    const res = await fetch(comfyUrl() + '/history/' + encodeURIComponent(promptId));
    if (!res.ok) return { status: 'unknown', http: res.status };
    const payload = (await res.json()) as Record<string, { outputs?: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }>; status?: { completed?: boolean } }>;
    const entry = payload[promptId];
    if (!entry) return { status: 'running', prompt_id: promptId };
    const images: string[] = [];
    for (const out of Object.values(entry.outputs ?? {})) {
      for (const img of out.images ?? []) {
        images.push('/api/v1/comfy/view?filename=' + encodeURIComponent(img.filename) + '&subfolder=' + encodeURIComponent(img.subfolder) + '&type=' + encodeURIComponent(img.type));
      }
    }
    return { status: entry.status?.completed ? 'done' : 'running', prompt_id: promptId, images };
  });

  app.get('/comfy/view', async (req, reply) => {
    const q = req.query as { filename?: string; subfolder?: string; type?: string };
    if (!q.filename) throw badRequest('缺少 filename');
    const url = comfyUrl() + '/view?filename=' + encodeURIComponent(q.filename) + '&subfolder=' + encodeURIComponent(q.subfolder ?? '') + '&type=' + encodeURIComponent(q.type ?? 'output');
    const res = await fetch(url);
    if (!res.ok) throw badRequest('ComfyUI 取图失败：HTTP ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    reply.type(res.headers.get('content-type') ?? 'image/png').send(buf);
  });
}
