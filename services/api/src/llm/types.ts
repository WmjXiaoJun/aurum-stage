/** 26.4 多 LLM 适配层：对上统一能力接口，对下适配不同协议 */
export type LlmProtocol = 'openai' | 'google' | 'ollama' | 'custom-openai';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  max_tokens?: number;
  tools?: Array<Record<string, unknown>>;
  json_schema?: Record<string, unknown>;
}

export interface ChatResult {
  content: string;
  raw?: unknown;
  usage?: { prompt_tokens: number; completion_tokens: number };
  model: string;
  provider: string;
  latency_ms: number;
  degraded?: boolean;
}

export interface ModelInfo {
  model_id: string;
  display_name?: string;
  capabilities: string[];
  context_len?: number;
}

export interface TextBackend {
  key: string;
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult>;
  structured<T>(schema: Record<string, unknown>, messages: ChatMessage[], options?: ChatOptions): Promise<{ data: T; chat: ChatResult }>;
  vision(imageUrlOrBase64: string, prompt: string): Promise<ChatResult>;
  embed(text: string): Promise<number[]>;
  health(): Promise<{ ok: boolean; detail: string }>;
  listModels(): Promise<ModelInfo[]>;
}

export interface ProviderRow {
  id: number;
  provider_key: string;
  display_name: string;
  protocol: string;
  base_url: string;
  api_keys: string[];
  enabled: 0 | 1;
  is_default: 0 | 1;
  health: string;
  last_check: string | null;
  meta: Record<string, unknown>;
}
