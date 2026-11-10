import type { FastifyInstance } from 'fastify';
import { all, get, jstr, json, nowIso, run } from '../db/index.js';
import { badRequest, notFound } from '../http/errors.js';
import { mapTemplate } from '../domain/mappers.js';
import { createProject } from '../domain/project-service.js';
import { TEMPLATE_TYPES } from '@aurum/core';
import fs from 'node:fs';
import path from 'node:path';
import { objectPath } from '../adapters/storage.js';

export async function registerTemplateRoutes(app: FastifyInstance): Promise<void> {
  app.get('/templates', async (req) => {
    const type = (req.query as { type?: string }).type;
    const rows = type
      ? all('SELECT * FROM workflow_template WHERE template_type = ? ORDER BY id', [type])
      : all('SELECT * FROM workflow_template ORDER BY template_type, id');
    return rows.map(mapTemplate);
  });

  app.get('/templates/:key', async (req) => {
    const key = String((req.params as { key: string }).key);
    const row = get('SELECT * FROM workflow_template WHERE template_key = ?', [key]);
    if (!row) throw notFound('模板不存在');
    return mapTemplate(row);
  });

  // 模板封面缩略图（综艺形态模板由本机 SDXL 生成）
  app.get('/templates/:key/cover', async (req, reply) => {
    const key = String((req.params as { key: string }).key);
    const abs = objectPath('assets', 'templates/' + key + '.png');
    if (!fs.existsSync(abs)) { reply.status(404).type('text/plain').send('无封面'); return; }
    const buf = fs.readFileSync(abs);
    reply
      .type('image/png')
      .header('Content-Length', String(buf.length))
      .header('Cache-Control', 'public, max-age=300')
      .send(buf);
  });

  // 用模板建项目（stage 场景 + 两镜），供生产链路继续渲染
  // 模板验证片（20s 左右），供模板库直接播放
  app.get('/templates/:key/preview', async (req, reply) => {
    const key = String((req.params as { key: string }).key);
    const file = path.join(process.cwd(), '..', '..', 'deliverables', 'templates', key + '.mp4');
    if (!fs.existsSync(file)) { reply.status(404).type('text/plain').send('没有预览片'); return; }
    const stat = fs.statSync(file);
    const range = String((req.headers as Record<string, string | undefined>).range ?? '').trim();
    if (/^bytes=\d*-\d*$/.test(range)) {
      const [s0, e0] = range.replace('bytes=', '').split('-');
      const start = s0 ? Number(s0) : 0;
      const end = e0 ? Math.min(Number(e0), stat.size - 1) : stat.size - 1;
      reply.status(206).type('video/mp4').header('Accept-Ranges', 'bytes').header('Content-Range', 'bytes ' + start + '-' + end + '/' + stat.size).header('Content-Length', String(end - start + 1));
      return reply.send(fs.createReadStream(file, { start, end }));
    }
    reply.type('video/mp4').header('Accept-Ranges', 'bytes').header('Content-Length', String(stat.size));
    return reply.send(fs.createReadStream(file));
  });

  app.post('/templates/:key/apply', async (req, reply) => {
    const key = String((req.params as { key: string }).key);
    const body = (req.body ?? {}) as { name?: string; visual_style?: string; aspect?: string };
    const row = get('SELECT * FROM workflow_template WHERE template_key = ?', [key]);
    if (!row) throw notFound('模板不存在');
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(String(row.template_body ?? '{}')) as Record<string, unknown>; } catch { parsed = {}; }
    const stage = (parsed.stage ?? {}) as { scene_desc?: string };
    const label = String(row.display_name ?? key);
    const name = body.name ?? ('模板作品 · ' + label);
    const visual = String(body.visual_style ?? row.visual_style ?? 'photoreal');
    const aspect = String(body.aspect ?? (parsed.aspect as string) ?? '16:9');
    const project = createProject({ name, variety_type: 'talk_show', visual_style: visual as never, aspect_ratio: aspect, style_prompt: String(stage.scene_desc ?? ''), style_negative: '' });
    const seg = run('INSERT INTO segment (project_id, seq, segment_type, title, default_engine, duration_ms, created_at) VALUES (?,?,?,?,?,?,?)', [project.id, 1, 'talk_round', label, 'muse_api', 0, nowIso()]);
    const segmentId = seg.lastInsertRowid;
    const scene = String(stage.scene_desc ?? 'variety show studio');
    for (let i = 0; i < 2; i++) {
      const line = i === 0 ? '欢迎来到「' + label + '」，今晚我们从这里开场。' : '这个舞台的每一个角落，都为主持人准备好了。';
      run('INSERT INTO round_shot (project_id, segment_id, seq, shot_code, speaker_role_id, speaker_name, camera, lines, text_clean, emotion, emotion_instruction, performance_tags, visual_prompt, negative_prompt, overlays, render_engine, visual_style, engine_params, tts_engine, voice_id, tts_speed, lipsync_required, native_audio, privacy, manual_edited, status, duration_ms, target_duration_ms, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [
        project.id, segmentId, i + 1, 'T' + (i + 1), 'c_host', '主持人', i === 0 ? 'wide' : 'medium_shot',
        JSON.stringify([line]), line, 'friendly_smile', '', '[]',
        scene + ', ' + (i === 0 ? 'wide establishing shot of the stage, cinematic lighting' : 'medium shot of the host on stage, cinematic lighting'),
        '', '[]', 'muse_api', visual, '{}', 'edge-tts', 'v_host', 1, 0, 0, 0, 1, 'generated', 10000, 10000, nowIso(), nowIso()
      ]);
    }
    reply.status(201);
    return { project_id: project.id, template_key: key, visual_style: visual, aspect };
  });

  // 工程模板实例化：按工程模板的结构建项目（段/镜/台词占位）
  app.post('/templates/:key/instantiate', async (req, reply) => {
    const key = String((req.params as { key: string }).key);
    const bodyIn = (req.body ?? {}) as { name?: string; slots?: Record<string, string | null> };
    const row = get('SELECT * FROM workflow_template WHERE template_key = ?', [key]);
    if (!row) throw notFound('模板不存在');
    let tpl: Record<string, unknown> = {};
    try { tpl = JSON.parse(String(row.template_body ?? '{}')) as Record<string, unknown>; } catch { tpl = {}; }
    const meta = (tpl.meta ?? {}) as Record<string, unknown>;
    const script = (tpl.script ?? {}) as { segments?: Array<Record<string, unknown>> };
    const shotsBlock = (tpl.shots ?? {}) as { shots?: Array<Record<string, unknown>> };
    const styleMap: Record<string, string> = { realistic: 'photoreal', '2d': 'anime_2d', '3d': 'cgi_3d', comic: 'comic', photoreal: 'photoreal', anime_2d: 'anime_2d', cgi_3d: 'cgi_3d' };
    const visual = styleMap[String(bodyIn.slots?.visual_style ?? meta.visual_style ?? 'realistic')] ?? 'photoreal';
    const language = String(bodyIn.slots?.language ?? meta.language ?? 'zh');
    const name = bodyIn.name ?? (String(row.display_name ?? key) + ' · 实例');
    const project = createProject({ name, variety_type: 'talk_show', visual_style: visual as never, aspect_ratio: String(meta.aspect_ratio ?? '16:9'), style_prompt: '', style_negative: '' });
    run('UPDATE project SET language = ?, auto_compose = 1 WHERE id = ?', [language, project.id]);
    for (const seg of script.segments ?? []) {
      const segRes = run('INSERT INTO segment (project_id, seq, segment_type, title, default_engine, duration_ms, created_at) VALUES (?,?,?,?,?,?,?)', [
        project.id, Number(seg.segment_index ?? 1) + 1, String(seg.segment_type ?? 'talk_round'), String(seg.title ?? '环节'), 'muse_api', Math.round(Number(seg.duration_sec ?? 0) * 1000), nowIso()
      ]);
      const rounds = (seg.rounds ?? []) as Array<Record<string, unknown>>;
      let seq = 0;
      for (const round of rounds) {
        for (const line of ((round.lines ?? []) as Array<Record<string, unknown>>)) {
          seq += 1;
          const text = String(line.text ?? '');
          const dur = Math.round(Number(line.duration_sec ?? 4) * 1000);
          run('INSERT INTO round_shot (project_id, segment_id, seq, shot_code, speaker_role_id, speaker_name, camera, lines, text_clean, emotion, emotion_instruction, performance_tags, visual_prompt, negative_prompt, overlays, render_engine, visual_style, engine_params, tts_engine, voice_id, tts_speed, lipsync_required, native_audio, privacy, manual_edited, status, duration_ms, target_duration_ms, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [
            project.id, segRes.lastInsertRowid, seq, 'T' + seq, line.speaker_id ?? 'c_host', String(line.speaker_name ?? '主持人'), 'medium_shot',
            JSON.stringify([text]), text, 'friendly_smile', '', JSON.stringify(line.performance_tags ?? []),
            String(((shotsBlock.shots ?? [])[seq - 1] ?? {}).prompt ?? 'variety show studio, cinematic lighting'), '', '[]',
            'muse_api', visual, '{}', 'edge-tts', 'v_host', 1, 0, 0, 0, 1, 'empty', dur, dur, nowIso(), nowIso()
          ]);
        }
      }
    }
    reply.status(201);
    return { project_id: project.id, template_key: key, visual_style: visual, language };
  });

  app.post('/templates', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (!body.template_key || !body.template_type) throw badRequest('缺少 template_key / template_type');
    if (!TEMPLATE_TYPES.includes(String(body.template_type) as never)) throw badRequest('非法模板类型');
    run(
      'INSERT OR REPLACE INTO workflow_template (template_key, template_type, display_name, template_body, param_map, params_schema, constraints, enabled, visual_style, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [
        String(body.template_key), String(body.template_type), String(body.display_name ?? body.template_key),
        jstr(body.template_body ?? {}), jstr(body.param_map ?? {}), jstr(body.params_schema ?? {}), jstr(body.constraints ?? {}),
        body.enabled === false ? 0 : 1, body.visual_style ?? null, nowIso()
      ]
    );
    reply.status(201);
    return mapTemplate(get('SELECT * FROM workflow_template WHERE template_key = ?', [String(body.template_key)]) as Record<string, unknown>);
  });

  app.patch('/templates/:key', async (req) => {
    const key = String((req.params as { key: string }).key);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const k of ['display_name', 'enabled', 'visual_style']) {
      if (k in body) { fields.push(k + ' = ?'); values.push(typeof body[k] === 'boolean' ? (body[k] ? 1 : 0) : body[k]); }
    }
    for (const k of ['template_body', 'param_map', 'params_schema', 'constraints']) {
      if (k in body) { fields.push(k + ' = ?'); values.push(jstr(body[k])); }
    }
    if (fields.length) { values.push(key); run('UPDATE workflow_template SET ' + fields.join(', ') + ' WHERE template_key = ?', values); }
    const row = get('SELECT * FROM workflow_template WHERE template_key = ?', [key]);
    if (!row) throw notFound('模板不存在');
    return mapTemplate(row);
  });

  app.delete('/templates/:key', async (req) => {
    run('DELETE FROM workflow_template WHERE template_key = ?', [String((req.params as { key: string }).key)]);
    return { ok: true };
  });
}
