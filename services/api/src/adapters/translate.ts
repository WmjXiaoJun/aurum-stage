/** 出海本地化：用 DeepSeek 批量翻译台词，失败回退原句 */
import { config } from '../config.js';
import { logger } from '../logger.js';
import { ApiError } from '../http/errors.js';
import { deepseekKey } from '../domain/settings-service.js';

export const LANGUAGE_LABEL: Record<string, string> = {
  zh: '中文', en: '英语', es: '西班牙语', ja: '日语', ko: '韩语', pt: '葡萄牙语'
};

const LANG_NAME: Record<string, string> = {
  en: 'English', es: 'Spanish', ja: 'Japanese', ko: 'Korean', pt: 'Portuguese', zh: 'Chinese'
};

export async function translateLines(lines: string[], language: string): Promise<string[]> {
  const target = LANG_NAME[language];
  if (!target || language === 'zh') return lines;
  const key = deepseekKey();
  if (!key) throw new ApiError('LLM_UNAVAILABLE', '未配置文本模型，无法本地化');
  const out: string[] = [];
  const batchSize = 12;
  for (let i = 0; i < lines.length; i += batchSize) {
    const batch = lines.slice(i, i + batchSize);
    const payload = {
      model: 'deepseek-chat',
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'You are a professional subtitling translator for a Chinese variety show. Translate each line into ' + target + ' keeping spoken rhythm, colloquial tone and length close to the original. Return ONLY a JSON array of strings, same order and same count.' },
        { role: 'user', content: JSON.stringify(batch) }
      ]
    };
    const res = await fetch(config.llm.deepseekBase + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify(payload)
    });
    const text = await res.text();
    if (!res.ok) throw new ApiError('LLM_UNAVAILABLE', '翻译失败：HTTP ' + res.status, { body: text.slice(0, 200) });
    const content = String((JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content ?? '');
    const match = content.match(/\[[\s\S]*\]/);
    let parsed: string[] = [];
    try { parsed = match ? JSON.parse(match[0]) : []; } catch { parsed = []; }
    if (parsed.length !== batch.length) {
      logger.warn('翻译条数不一致，按原句回退', { service: 'localize', got: parsed.length, want: batch.length });
      parsed = batch;
    }
    out.push(...parsed.map((s) => String(s)));
  }
  return out;
}
