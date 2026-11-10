/** 具体协议实现：OpenAI 兼容（含 Ollama/vLLM/自定义网关）与 Google 兼容，外加零依赖离线引擎。 */
import { logger } from '../logger.js';
import { ApiError } from '../http/errors.js';
import type { ChatMessage, ChatOptions, ChatResult, ModelInfo, ProviderRow, TextBackend } from './types.js';

function inferCapabilities(modelId: string): string[] {
  const id = modelId.toLowerCase();
  const caps = ['chat'];
  if (/gpt-4|gemini|claude|qwen-vl|llava|vision|glm-4v|doubao/.test(id)) caps.push('vision');
  if (/embed|bge|text-embedding/.test(id)) caps.push('embed');
  if (/json|tool|function/.test(id)) caps.push('tools');
  caps.push('structured');
  return Array.from(new Set(caps));
}

class KeyRing {
  private keys: string[];
  private cursor = 0;
  private unhealthy = new Map<string, number>();

  constructor(keys: string[]) {
    this.keys = keys.filter(Boolean);
  }

  next(): string | null {
    if (this.keys.length === 0) return null;
    const now = Date.now();
    for (let i = 0; i < this.keys.length; i++) {
      const key = this.keys[(this.cursor + i) % this.keys.length];
      const until = this.unhealthy.get(key) ?? 0;
      if (until < now) {
        this.cursor = (this.cursor + i + 1) % this.keys.length;
        return key;
      }
    }
    const key = this.keys[this.cursor % this.keys.length];
    this.cursor = (this.cursor + 1) % this.keys.length;
    return key;
  }

  markBad(key: string, cooldownMs = 60_000): void {
    this.unhealthy.set(key, Date.now() + cooldownMs);
  }

  size(): number {
    return this.keys.length;
  }
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function postJson(url: string, body: unknown, headers: Record<string, string>, timeoutMs = 120_000): Promise<{ status: number; json: unknown; text: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    const text = await res.text();
    let parsed: unknown = null;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    return { status: res.status, json: parsed, text };
  } finally {
    clearTimeout(timer);
  }
}

export class OpenAiCompatibleBackend implements TextBackend {
  readonly key: string;
  private provider: ProviderRow;
  private keys: KeyRing;
  private model: string;

  constructor(provider: ProviderRow, model: string) {
    this.provider = provider;
    this.key = provider.provider_key;
    this.keys = new KeyRing(provider.api_keys ?? []);
    this.model = model;
  }

  private base(): string {
    return (this.provider.base_url ?? '').replace(/\/$/, '');
  }

  private headers(): Record<string, string> {
    const key = this.keys.next();
    const out: Record<string, string> = {};
    if (key) out.Authorization = 'Bearer ' + key;
    return out;
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResult> {
    const started = Date.now();
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: options.temperature ?? 0.7,
      stream: false
    };
    if (options.max_tokens) body.max_tokens = options.max_tokens;
    if (options.json_schema) {
      body.response_format = { type: 'json_object' };
    }
    if (options.tools) body.tools = options.tools;

    const key = this.keys.next();
    if (!key && !/localhost|127\.0\.0\.1|ollama|vllm/.test(this.base())) {
      throw new ApiError('LLM_UNAVAILABLE', '供应商未配置可用 Key：' + this.provider.provider_key);
    }
    const headers: Record<string, string> = key ? { Authorization: 'Bearer ' + key } : {};

    let attempt = 0;
    while (attempt < 2) {
      attempt += 1;
      try {
        const res = await postJson(this.base() + '/chat/completions', body, headers);
        if (res.status === 429) {
          if (key) this.keys.markBad(key, 30_000);
          throw new HttpError(429, '限流');
        }
        if (res.status >= 400) throw new HttpError(res.status, res.text.slice(0, 300));
        const parsed = res.json as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number }; model?: string };
        const content = parsed.choices?.[0]?.message?.content ?? '';
        return {
          content,
          raw: res.json,
          usage: {
            prompt_tokens: Number(parsed.usage?.prompt_tokens ?? 0),
            completion_tokens: Number(parsed.usage?.completion_tokens ?? 0)
          },
          model: parsed.model ?? this.model,
          provider: this.provider.provider_key,
          latency_ms: Date.now() - started
        };
      } catch (err) {
        if (attempt >= 2) {
          throw new ApiError('LLM_UNAVAILABLE', '文本后端请求失败：' + String((err as Error).message).slice(0, 200));
        }
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    throw new ApiError('LLM_UNAVAILABLE', '文本后端请求失败');
  }

  async structured<T>(schema: Record<string, unknown>, messages: ChatMessage[], options: ChatOptions = {}): Promise<{ data: T; chat: ChatResult }> {
    const sys: ChatMessage = {
      role: 'system',
      content: '只输出符合以下 JSON Schema 的 JSON，不要输出任何解释、markdown 代码块或多余文字。\nJSON Schema:\n' + JSON.stringify(schema)
    };
    const chat = await this.chat([sys, ...messages], { ...options, json_schema: schema });
    const data = parseJsonLoose<T>(chat.content);
    if (data == null) {
      const repair = await this.chat([
        sys,
        ...messages,
        { role: 'assistant', content: chat.content.slice(0, 2000) },
        { role: 'user', content: '上面的输出不是合法 JSON。请严格只输出 JSON，键名与 Schema 一致。' }
      ], { ...options, json_schema: schema });
      const repaired = parseJsonLoose<T>(repair.content);
      if (repaired == null) throw new ApiError('LLM_SCHEMA_FAIL', '结构化输出校验失败（两次尝试）');
      return { data: repaired, chat: repair };
    }
    return { data, chat };
  }

  async vision(imageUrlOrBase64: string, prompt: string): Promise<ChatResult> {
    const started = Date.now();
    const isUrl = /^https?:/.test(imageUrlOrBase64);
    const url = isUrl ? imageUrlOrBase64 : 'data:image/png;base64,' + imageUrlOrBase64;
    const key = this.keys.next();
    const body = {
      model: this.model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url } }
          ]
        }
      ]
    };
    const res = await postJson(this.base() + '/chat/completions', body, key ? { Authorization: 'Bearer ' + key } : {});
    if (res.status >= 400) throw new ApiError('LLM_UNAVAILABLE', '视觉理解失败：HTTP ' + res.status);
    const parsed = res.json as { choices?: Array<{ message?: { content?: string } }> };
    return {
      content: parsed.choices?.[0]?.message?.content ?? '',
      raw: res.json,
      model: this.model,
      provider: this.provider.provider_key,
      latency_ms: Date.now() - started
    };
  }

  async embed(): Promise<number[]> {
    return [];
  }

  async health(): Promise<{ ok: boolean; detail: string }> {
    try {
      const res = await fetch(this.base() + '/models', { headers: this.headers() });
      return { ok: res.ok, detail: 'HTTP ' + res.status };
    } catch (err) {
      return { ok: false, detail: String((err as Error).message).slice(0, 120) };
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const res = await fetch(this.base() + '/models', { headers: this.headers() });
      if (!res.ok) return [];
      const parsed = (await res.json()) as { data?: Array<{ id: string }> };
      return (parsed.data ?? []).map((m) => ({ model_id: m.id, display_name: m.id, capabilities: inferCapabilities(m.id) }));
    } catch {
      return [];
    }
  }
}

export class GoogleBackend implements TextBackend {
  readonly key: string;
  private provider: ProviderRow;
  private keys: KeyRing;
  private model: string;

  constructor(provider: ProviderRow, model: string) {
    this.provider = provider;
    this.key = provider.provider_key;
    this.keys = new KeyRing(provider.api_keys ?? []);
    this.model = model;
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResult> {
    const started = Date.now();
    const key = this.keys.next();
    if (!key) throw new ApiError('LLM_UNAVAILABLE', 'Google 供应商未配置 Key');
    const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    const contents = messages.filter((m) => m.role !== 'system').map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));
    const url = this.provider.base_url.replace(/\/$/, '') + '/models/' + this.model + ':generateContent?key=' + key;
    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: options.temperature ?? 0.7,
        ...(options.max_tokens ? { maxOutputTokens: options.max_tokens } : {}),
        ...(options.json_schema ? { responseMimeType: 'application/json' } : {})
      }
    };
    if (sys) body.systemInstruction = { parts: [{ text: sys }] };
    const res = await postJson(url, body, {});
    if (res.status >= 400) throw new ApiError('LLM_UNAVAILABLE', 'Google 后端失败：HTTP ' + res.status);
    const parsed = res.json as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } };
    const content = parsed.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    return {
      content,
      raw: res.json,
      usage: {
        prompt_tokens: Number(parsed.usageMetadata?.promptTokenCount ?? 0),
        completion_tokens: Number(parsed.usageMetadata?.candidatesTokenCount ?? 0)
      },
      model: this.model,
      provider: this.provider.provider_key,
      latency_ms: Date.now() - started
    };
  }

  async structured<T>(schema: Record<string, unknown>, messages: ChatMessage[], options: ChatOptions = {}): Promise<{ data: T; chat: ChatResult }> {
    const sys: ChatMessage = { role: 'system', content: '只输出 JSON，符合 Schema：' + JSON.stringify(schema) };
    const chat = await this.chat([sys, ...messages], { ...options, json_schema: schema });
    const data = parseJsonLoose<T>(chat.content);
    if (data == null) throw new ApiError('LLM_SCHEMA_FAIL', '结构化输出校验失败');
    return { data, chat };
  }

  async vision(imageUrlOrBase64: string, prompt: string): Promise<ChatResult> {
    return this.chat([{ role: 'user', content: prompt + '\n[image]' + imageUrlOrBase64.slice(0, 64) }], {});
  }

  async embed(): Promise<number[]> {
    return [];
  }

  async health(): Promise<{ ok: boolean; detail: string }> {
    return { ok: (this.provider.api_keys ?? []).length > 0, detail: 'keys:' + (this.provider.api_keys ?? []).length };
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const key = this.keys.next();
      const res = await fetch(this.provider.base_url.replace(/\/$/, '') + '/models?key=' + key);
      if (!res.ok) return [];
      const parsed = (await res.json()) as { models?: Array<{ name: string }> };
      return (parsed.models ?? []).map((m) => ({ model_id: String(m.name).replace(/^models\//, ''), capabilities: inferCapabilities(m.name) }));
    } catch {
      return [];
    }
  }
}

export function parseJsonLoose<T>(text: string): T | null {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  const slices = [candidate];
  if (start >= 0 && end > start) slices.push(candidate.slice(start, end + 1));
  for (const s of slices) {
    try {
      return JSON.parse(s.trim()) as T;
    } catch {
      continue;
    }
  }
  return null;
}

export function buildHttpBackend(provider: ProviderRow, model: string): TextBackend {
  if (provider.protocol === 'google') return new GoogleBackend(provider, model);
  return new OpenAiCompatibleBackend(provider, model);
}

export { logger };
