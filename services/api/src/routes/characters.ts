import type { FastifyInstance } from 'fastify';
import { all, get, json, nowIso, run } from '../db/index.js';
import { badRequest, notFound } from '../http/errors.js';
import { mapCharacter, mapRefImage, mapVoice } from '../domain/mappers.js';
import { generateCharacterArt, characterFiles, type GenerateArtInput } from '../adapters/character-art.js';
import { autoSetupCharacter } from '../domain/character-autopack.js';
import { synthesize } from '../adapters/tts.js';

function withRelations(row: Record<string, unknown>) {
  const character = mapCharacter(row);
  const refs = all('SELECT * FROM character_ref_image WHERE character_id = ?', [character.id]).map(mapRefImage);
  const voiceRow = get('SELECT * FROM voice_asset WHERE project_id = ? AND role_id = ?', [character.project_id, character.role_id]);
  return { ...character, ref_images: refs, voice: voiceRow ? mapVoice(voiceRow) : null };
}

const VOICE_PRESETS = [
  { id: 'laozhou', label: '老周 · 低沉磁性（男）', instruction: '男声，五十岁左右，低沉磁性，语速偏慢，冷幽默' },
  { id: 'ali', label: '阿丽 · 明亮清脆（女）', instruction: '女声，二十五岁左右，明亮清脆，语速偏快，俏皮' },
  { id: 'dawei', label: '大伟 · 沉稳沙哑（男）', instruction: '男声，四十岁左右，沉稳沙哑，语速中等，严肃' },
  { id: 'qingnian', label: '青年 · 干净少年音（男）', instruction: '男声，二十二岁左右，干净少年音，语速轻快' },
  { id: 'wenrou', label: '温婉 · 成熟女声（女）', instruction: '女声，三十五岁左右，温婉成熟，语速平缓，亲和' }
];

export async function registerCharacterRoutes(app: FastifyInstance): Promise<void> {
  /** 全局角色库：跨项目列出所有启用角色，带封面与所属项目 */
  app.get('/characters', async () => {
    const rows = all<Record<string, unknown>>(
      "SELECT c.*, p.name AS project_name, p.visual_style AS project_style FROM character_asset c JOIN project p ON p.id = c.project_id WHERE c.is_active = 1 ORDER BY c.id DESC"
    );
    return rows.map((row) => {
      const character = withRelations(row);
      const first = (character.ref_images ?? [])[0];
      return { ...character, project_name: String(row.project_name ?? ''), project_style: String(row.project_style ?? ''), cover_url: first ? '/api/v1/assets/' + first.asset_id + '/raw' : null };
    });
  });

  app.get('/projects/:id/characters', async (req) => {
    const projectId = Number((req.params as { id: string }).id);
    return all('SELECT * FROM character_asset WHERE project_id = ? AND is_active = 1 ORDER BY role_type, id', [projectId]).map(withRelations);
  });

  app.get('/characters/:id', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const row = get('SELECT * FROM character_asset WHERE id = ?', [id]);
    if (!row) throw notFound('角色不存在');
    return withRelations(row);
  });

  app.post('/projects/:id/characters', async (req, reply) => {
    const projectId = Number((req.params as { id: string }).id);
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (!body.name) throw badRequest('缺少角色名 name');
    const roleId = String(body.role_id ?? 'c_' + Math.random().toString(36).slice(2, 8));
    const res = run(
      'INSERT INTO character_asset (project_id, role_id, version, name, role_type, persona, prompt_prefix, negative_extra, lock_seed, seed, is_active, anchor_prompt, authorization_file_hash, authorized_until, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [
        projectId, roleId, 1, String(body.name), String(body.role_type ?? 'guest'), String(body.persona ?? ''),
        String(body.prompt_prefix ?? ''), String(body.negative_extra ?? ''), body.lock_seed === false ? 0 : 1,
        body.seed == null ? Math.floor(Math.random() * 1_000_000) : Number(body.seed), 1,
        String(body.anchor_prompt ?? ''), body.authorization_file_hash ?? null, body.authorized_until ?? null, nowIso()
      ]
    );
    autoSetupCharacter(Number(res.lastInsertRowid));
    reply.status(201);
    return withRelations(get('SELECT * FROM character_asset WHERE id = ?', [res.lastInsertRowid]) as Record<string, unknown>);
  });

  app.patch('/characters/:id', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const key of ['name', 'role_type', 'persona', 'prompt_prefix', 'negative_extra', 'anchor_prompt', 'seed', 'lock_seed', 'is_active', 'authorization_file_hash', 'authorized_until']) {
      if (key in body) {
        fields.push(key + ' = ?');
        values.push(typeof body[key] === 'boolean' ? (body[key] ? 1 : 0) : body[key]);
      }
    }
    if (fields.length) {
      values.push(id);
      run('UPDATE character_asset SET ' + fields.join(', ') + ' WHERE id = ?', values);
    }
    const row = get('SELECT * FROM character_asset WHERE id = ?', [id]);
    if (!row) throw notFound('角色不存在');
    return withRelations(row);
  });

  app.delete('/characters/:id', async (req) => {
    run('UPDATE character_asset SET is_active = 0 WHERE id = ?', [Number((req.params as { id: string }).id)]);
    return { ok: true };
  });

  app.post('/characters/:id/ref-images', async (req, reply) => {
    const characterId = Number((req.params as { id: string }).id);
    const body = (req.body ?? {}) as { asset_id?: number; angle?: string; weight?: number };
    if (!body.asset_id) throw badRequest('缺少 asset_id');
    run('INSERT INTO character_ref_image (character_id, asset_id, angle, weight) VALUES (?,?,?,?)', [
      characterId, Number(body.asset_id), body.angle ?? 'front', Number(body.weight ?? 1)
    ]);
    reply.status(201);
    return all('SELECT * FROM character_ref_image WHERE character_id = ?', [characterId]).map(mapRefImage);
  });

  app.delete('/characters/:id/ref-images/:refId', async (req) => {
    run('DELETE FROM character_ref_image WHERE id = ? AND character_id = ?', [
      Number((req.params as { refId: string }).refId), Number((req.params as { id: string }).id)
    ]);
    return { ok: true };
  });

  /** 一键自动：全套形象图 + 音色（用于老角色补齐） */
  app.post('/characters/:id/auto', async (req) => {
    const id = Number((req.params as { id: string }).id);
    autoSetupCharacter(id);
    return { ok: true, queued: true };
  });

  app.get('/voices', async () => VOICE_PRESETS);

  /** 角色音色绑定：同一角色只保留一条启用音色 */
  app.post('/characters/:id/voice', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const row = get('SELECT * FROM character_asset WHERE id = ?', [id]);
    if (!row) throw notFound('角色不存在');
    const body = (req.body ?? {}) as { engine?: string; voice_id?: string; preset?: string; instruction?: string };
    const engine = String(body.engine ?? 'edge');
    const roleId = String(row.role_id ?? '');
    const projectId = Number(row.project_id);
    const preset = VOICE_PRESETS.find((p) => p.id === body.preset);
    const voiceId = String(body.voice_id ?? (preset ? 'breeze_' + preset.id : engine === 'breeze' ? 'breeze_role_' : 'v_host'));
    const instruction = String(body.instruction ?? preset?.instruction ?? '');
    run('UPDATE voice_asset SET is_active = 0 WHERE project_id = ? AND role_id = ?', [projectId, roleId]);
    const existing = get('SELECT id FROM voice_asset WHERE project_id = ? AND voice_id = ?', [projectId, voiceId]);
    if (existing) run('UPDATE voice_asset SET is_active = 1, provider = ?, role_id = ?, instruction = ? WHERE id = ?', [engine, roleId, instruction, Number(existing.id)]);
    else run('INSERT INTO voice_asset (project_id, voice_id, role_id, provider, base_speed, available_emotions, instruction, is_active, created_at) VALUES (?,?,?,?,?,?,?,1,?)', [projectId, voiceId, roleId, engine, 1, '[]', instruction, nowIso()]);
    return get('SELECT * FROM voice_asset WHERE project_id = ? AND voice_id = ?', [projectId, voiceId]);
  });

  /** 角色工坊：生成概念立绘 / 三视图 / 表情包（本机 SDXL + IP-Adapter） */
  app.post('/characters/:id/generate', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const input: GenerateArtInput = {
      character_id: id,
      modes: Array.isArray(body.modes) ? (body.modes as GenerateArtInput['modes']) : undefined,
      count: body.count == null ? 1 : Number(body.count),
      style: body.style == null ? undefined : String(body.style),
      extra_prompt: body.extra_prompt == null ? undefined : String(body.extra_prompt)
    };
    const result = await generateCharacterArt(input);
    return { ...result, files: characterFiles(id) };
  });

  app.get('/characters/:id/files', async (req) => {
    return characterFiles(Number((req.params as { id: string }).id));
  });

  /** 角色试音：用角色绑定的音色合成一句样音 */
  app.post('/characters/:id/audition', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const row = get('SELECT * FROM character_asset WHERE id = ?', [id]);
    if (!row) throw notFound('角色不存在');
    const body = (req.body ?? {}) as { text?: string; voice_id?: string };
    const character = mapCharacter(row);
    const text = String(body.text ?? ('大家好，我是' + character.name + '，这是我的声音。'));
    const auditionVoice = get('SELECT provider, voice_id FROM voice_asset WHERE project_id = ? AND role_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1', [character.project_id, String(character.role_id)]);
    const auditionEngine = String(auditionVoice?.provider ?? '') === 'breeze' ? ('breeze' as const) : undefined;
    const presetVoice = VOICE_PRESETS.find((p) => p.id === String((body as { preset?: string }).preset ?? ''));
    const result = await synthesize({
      project_id: character.project_id,
      shot_id: 0,
      task_id: 900000 + id,
      text,
      voice_id: String(body.voice_id ?? (presetVoice ? 'breeze_' + presetVoice.id : auditionVoice?.voice_id) ?? 'v_host'),
      engine: presetVoice ? ('breeze' as const) : auditionEngine,
      voice_instruction: String(presetVoice?.instruction ?? auditionVoice?.instruction ?? ''),
      emotion: 'friendly_smile',
      emotion_instruction: '',
      speed: 1,
      target_duration_ms: null,
      candidates: 1
    });
    const cand = result.candidates[0];
    return { url: cand.url, duration_ms: cand.duration_ms, engine: cand.engine, text };
  });

  /** 角色版本：换服装/换造型时新建版本，历史镜头仍指向旧版本 */
  app.post('/characters/:id/version', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const row = get('SELECT * FROM character_asset WHERE id = ?', [id]);
    if (!row) throw notFound('角色不存在');
    const maxV = get('SELECT MAX(version) AS v FROM character_asset WHERE project_id = ? AND role_id = ?', [Number(row.project_id), String(row.role_id)]);
    const nextVersion = Number(maxV?.v ?? 1) + 1;
    run('UPDATE character_asset SET is_active = 0 WHERE project_id = ? AND role_id = ?', [Number(row.project_id), String(row.role_id)]);
    const res = run(
      'INSERT INTO character_asset (project_id, role_id, version, name, role_type, persona, prompt_prefix, negative_extra, lock_seed, seed, is_active, anchor_prompt, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?)',
      [Number(row.project_id), String(row.role_id), nextVersion, String(row.name), String(row.role_type), String(row.persona ?? ''), String(row.prompt_prefix ?? ''), String(row.negative_extra ?? ''), Number(row.lock_seed), Number(row.seed ?? 0), String(row.anchor_prompt ?? ''), nowIso()]
    );
    const refs = all('SELECT * FROM character_ref_image WHERE character_id = ?', [id]);
    for (const ref of refs) {
      run('INSERT INTO character_ref_image (character_id, asset_id, angle, weight) VALUES (?,?,?,?)', [res.lastInsertRowid, Number(ref.asset_id), String(ref.angle), Number(ref.weight)]);
    }
    return withRelations(get('SELECT * FROM character_asset WHERE id = ?', [res.lastInsertRowid]) as Record<string, unknown>);
  });
}
