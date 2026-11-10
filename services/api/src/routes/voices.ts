import type { FastifyInstance } from 'fastify';
import { EMOTION_MAP } from '@aurum/core';
import { all, get, jstr, json, nowIso, run } from '../db/index.js';
import { badRequest, notFound } from '../http/errors.js';
import { mapVoice, mapVoiceRef } from '../domain/mappers.js';
import { findAsset } from '../adapters/storage.js';

function withRefs(row: Record<string, unknown>) {
  const voice = mapVoice(row);
  return {
    ...voice,
    ref_audios: all('SELECT * FROM voice_ref_audio WHERE voice_id = ?', [voice.id]).map(mapVoiceRef)
  };
}

export async function registerVoiceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/projects/:id/voices', async (req) => {
    const projectId = Number((req.params as { id: string }).id);
    return all('SELECT * FROM voice_asset WHERE project_id = ? ORDER BY id', [projectId]).map(withRefs);
  });

  app.post('/projects/:id/voices', async (req, reply) => {
    const projectId = Number((req.params as { id: string }).id);
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (!body.voice_id) throw badRequest('缺少 voice_id');
    run(
      'INSERT INTO voice_asset (project_id, voice_id, role_id, provider, base_speed, available_emotions, forbidden, is_active, authorization_file_hash, authorized_until, created_at) VALUES (?,?,?,?,?,?,?,1,?,?,?)',
      [
        projectId, String(body.voice_id), body.role_id ?? null, String(body.provider ?? 'indextts2'),
        Number(body.base_speed ?? 1), jstr(body.available_emotions ?? Object.keys(EMOTION_MAP).slice(0, 6)),
        String(body.forbidden ?? ''), body.authorization_file_hash ?? null, body.authorized_until ?? null, nowIso()
      ]
    );
    reply.status(201);
    return all('SELECT * FROM voice_asset WHERE project_id = ? ORDER BY id DESC LIMIT 1', [projectId]).map(withRefs)[0];
  });

  app.patch('/voices/:id', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const key of ['role_id', 'provider', 'base_speed', 'forbidden', 'is_active', 'authorization_file_hash', 'authorized_until']) {
      if (key in body) {
        fields.push(key + ' = ?');
        values.push(typeof body[key] === 'boolean' ? (body[key] ? 1 : 0) : key === 'base_speed' ? Number(body[key]) : body[key]);
      }
    }
    if ('available_emotions' in body) {
      fields.push('available_emotions = ?');
      values.push(jstr(body.available_emotions));
    }
    if (fields.length) {
      values.push(id);
      run('UPDATE voice_asset SET ' + fields.join(', ') + ' WHERE id = ?', values);
    }
    const row = get('SELECT * FROM voice_asset WHERE id = ?', [id]);
    if (!row) throw notFound('音色不存在');
    return withRefs(row);
  });

  app.delete('/voices/:id', async (req) => {
    run('DELETE FROM voice_asset WHERE id = ?', [Number((req.params as { id: string }).id)]);
    return { ok: true };
  });

  app.post('/voices/:id/ref-audios', async (req, reply) => {
    const voiceId = Number((req.params as { id: string }).id);
    const body = (req.body ?? {}) as { asset_id?: number; ref_type?: string; duration_sec?: number; note?: string };
    if (!body.asset_id) throw badRequest('缺少 asset_id');
    const asset = findAsset(Number(body.asset_id));
    if (!asset) throw notFound('素材不存在');
    run('INSERT INTO voice_ref_audio (voice_id, asset_id, ref_type, duration_sec, note) VALUES (?,?,?,?,?)', [
      voiceId, Number(body.asset_id), body.ref_type ?? 'normal', body.duration_sec ?? asset.duration_sec ?? null, body.note ?? ''
    ]);
    reply.status(201);
    return all('SELECT * FROM voice_ref_audio WHERE voice_id = ?', [voiceId]).map(mapVoiceRef);
  });

  app.delete('/voices/:id/ref-audios/:refId', async (req) => {
    run('DELETE FROM voice_ref_audio WHERE id = ? AND voice_id = ?', [
      Number((req.params as { refId: string }).refId), Number((req.params as { id: string }).id)
    ]);
    return { ok: true };
  });

  /** 参考音频体检（19.1）：时长 6–15s、至少两条、需含 emotional_peak */
  app.get('/voices/:id/health', async (req) => {
    const voiceId = Number((req.params as { id: string }).id);
    const voice = get('SELECT * FROM voice_asset WHERE id = ?', [voiceId]);
    if (!voice) throw notFound('音色不存在');
    const refs = all('SELECT * FROM voice_ref_audio WHERE voice_id = ?', [voiceId]).map(mapVoiceRef);
    const issues: string[] = [];
    if (refs.length < 2) issues.push('参考音频不足 2 条（IndexTTS-2 零样本建议 ≥2 条）');
    if (!refs.some((r) => r.ref_type === 'emotional_peak')) issues.push('缺少 emotional_peak 情绪参考音频');
    for (const r of refs) {
      if ((r.duration_sec ?? 0) < 6) issues.push('参考音频 #' + r.id + ' 时长不足 6 秒');
      if ((r.duration_sec ?? 0) > 15) issues.push('参考音频 #' + r.id + ' 超过 15 秒，建议截断');
    }
    return {
      voice_id: voice.voice_id,
      refs: refs.length,
      ok: issues.length === 0,
      issues,
      authorization: {
        file_hash: voice.authorization_file_hash ?? null,
        valid_until: voice.authorized_until ?? null
      }
    };
  });

  app.get('/emotions', async () => Object.values(EMOTION_MAP));
}
