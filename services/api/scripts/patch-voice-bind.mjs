import fs from 'node:fs';
const R = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\";
const W = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\web\\src\\";
function pf(p, fn) { let s = fs.readFileSync(p, 'utf8'); const o = fn(s); if (o !== s) { fs.writeFileSync(p, o); console.log('patched', p.split('\\').pop()); } }

// 后端：给角色绑定音色（落到 voice_asset）
pf(R + 'routes\\characters.ts', (s) => {
  if (s.includes('bindCharacterVoice')) return s;
  return s.replace("  /** 角色工坊：生成概念立绘", `  /** 角色音色绑定：同一角色只保留一条启用音色 */
  app.post('/characters/:id/voice', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const row = get('SELECT * FROM character_asset WHERE id = ?', [id]);
    if (!row) throw notFound('角色不存在');
    const body = (req.body ?? {}) as { engine?: string; voice_id?: string };
    const engine = String(body.engine ?? 'edge');
    const roleId = String(row.role_id ?? '');
    const projectId = Number(row.project_id);
    const voiceId = String(body.voice_id ?? (engine === 'breeze' ? 'breeze_role_' : 'v_host'));
    run('UPDATE voice_asset SET is_active = 0 WHERE project_id = ? AND role_id = ?', [projectId, roleId]);
    const existing = get('SELECT id FROM voice_asset WHERE project_id = ? AND voice_id = ?', [projectId, voiceId]);
    if (existing) run('UPDATE voice_asset SET is_active = 1, provider = ?, role_id = ? WHERE id = ?', [engine, roleId, Number(existing.id)]);
    else run('INSERT INTO voice_asset (project_id, voice_id, role_id, provider, base_speed, available_emotions, is_active, created_at) VALUES (?,?,?,?,?,?,1,?)', [projectId, voiceId, roleId, engine, 1, '[]', nowIso()]);
    return get('SELECT * FROM voice_asset WHERE project_id = ? AND voice_id = ?', [projectId, voiceId]);
  });

  /** 角色工坊：生成概念立绘`);
});

// 客户端
pf(W + 'lib\\api.ts', (s) => s.includes('bindCharacterVoice') ? s : s.replace(
  "  auditionCharacter: (characterId: number, body: Record<string, unknown>) =>",
  "  bindCharacterVoice: (characterId: number, body: Record<string, unknown>) => request<Record<string, unknown>>('/characters/' + characterId + '/voice', { method: 'POST', body: JSON.stringify(body) }),\n  auditionCharacter: (characterId: number, body: Record<string, unknown>) =>"
));
