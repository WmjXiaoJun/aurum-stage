/** 角色自动化：LLM 推断性别/年龄/音色 → 绑定 Breeze 音色；自动生成全套形象图 */
import { all, get, nowIso, run } from '../db/index.js';
import { generateCharacterArt } from '../adapters/character-art.js';
import { llmJson } from './skills-service.js';
import { logger } from '../logger.js';

export interface VoiceProfile { gender: 'male' | 'female'; age_range: string; tone: string; instruction: string; seed: number }

function fallbackProfile(name: string, persona: string): VoiceProfile {
  const female = /[姐妈妹女婉琳琪娜丽雅涵萱瑶媛倩玲静雯彤]/.test(name) || /女|她|姐|妈/.test(persona.slice(0, 40));
  const age = /50|55|60|资深|教授|老|导演|父/.test(persona) ? '50-60' : /20|25|年轻|实习|学生/.test(persona) ? '22-28' : '30-40';
  const tone = female ? (Number(age.split('-')[0]) < 30 ? '明亮清脆、语速偏快' : '温和稳重、略带磁性') : (Number(age.split('-')[0]) >= 50 ? '低沉沙哑、语速偏慢' : '中低音、稳重有亲和力');
  return { gender: female ? 'female' : 'male', age_range: age, tone, instruction: (female ? '女性' : '男性') + '，' + age + ' 岁，' + tone + '，综艺节目口播', seed: 20261026 + Math.floor(Math.random() * 999) };
}

export async function inferVoiceProfile(name: string, persona: string, roleType: string): Promise<VoiceProfile> {
  try {
    const body = await llmJson(
      '你是综艺选角与配音导演。根据角色姓名、人设、定位推断声音。只输出 JSON，字段：gender("male"|"female")、age_range("22-28"等)、tone(中文描述)、instruction(中文配音指导，30字内，写清性别年龄音色语速)、seed(整数)。',
      '姓名：' + name + '\n定位：' + roleType + '\n人设：' + persona
    );
    const gender = String(body.gender) === 'female' ? 'female' : 'male';
    return {
      gender,
      age_range: String(body.age_range ?? '30-40'),
      tone: String(body.tone ?? ''),
      instruction: String(body.instruction ?? ''),
      seed: Number(body.seed ?? 20261026) || 20261026
    };
  } catch { return fallbackProfile(name, persona); }
}

/** 绑定 Breeze 音色（存 instruction，供 TTS 用） */
export async function autoBindVoice(characterId: number): Promise<VoiceProfile | null> {
  const c = get('SELECT * FROM character_asset WHERE id = ?', [characterId]);
  if (!c) return null;
  const profile = await inferVoiceProfile(String(c.name), String(c.persona ?? ''), String(c.role_type ?? 'guest'));
  const projectId = Number(c.project_id);
  const voiceId = 'breeze_auto_' + characterId;
  run('UPDATE voice_asset SET is_active = 0 WHERE project_id = ? AND role_id = ?', [projectId, String(c.role_id)]);
  const existing = get('SELECT id FROM voice_asset WHERE project_id = ? AND voice_id = ?', [projectId, voiceId]);
  if (existing) run('UPDATE voice_asset SET is_active = 1, provider = ?, role_id = ?, instruction = ? WHERE id = ?', ['breeze', String(c.role_id), profile.instruction, Number(existing.id)]);
  else run('INSERT INTO voice_asset (project_id, voice_id, role_id, provider, base_speed, available_emotions, instruction, is_active, created_at) VALUES (?,?,?,?,?,?,?,1,?)', [projectId, voiceId, String(c.role_id), 'breeze', 1, '[]', profile.instruction, nowIso()]);
  return profile;
}

let chain: Promise<unknown> = Promise.resolve();
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

/** 自动生成全套形象图：立绘 + 三视图 + 表情（串行，避免打爆显存） */
export async function autoGenerateArtPack(characterId: number): Promise<number> {
  return enqueue(async () => {
    const c = get('SELECT * FROM character_asset WHERE id = ?', [characterId]);
    if (!c) return 0;
    const project = get('SELECT visual_style FROM project WHERE id = ?', [Number(c.project_id)]);
    const style = String(project?.visual_style ?? 'photoreal');
    run("UPDATE character_asset SET art_status = 'generating' WHERE id = ?", [characterId]);
    let count = 0;
    for (const kind of ['portrait', 'three_view', 'expressions'] as const) {
      if (kind === 'portrait' && get('SELECT id FROM character_ref_image WHERE character_id = ? LIMIT 1', [characterId])) continue;
      try {
        const res = await generateCharacterArt({ character_id: characterId, modes: [kind], count: 1, style });
        count += res.assets.length;
      } catch (e) { logger.warn('角色自动出图失败：' + String(e), { service: 'autopack', character_id: characterId, kind }); }
    }
    run("UPDATE character_asset SET art_status = ? WHERE id = ?", [count > 0 ? 'ready' : 'failed', characterId]);
    return count;
  });
}

/** 一键：推断音色 + 出全套图（后台跑，不阻塞请求） */
export function autoSetupCharacter(characterId: number): void {
  void autoBindVoice(characterId).catch(() => undefined);
  void autoGenerateArtPack(characterId).catch(() => undefined);
}
