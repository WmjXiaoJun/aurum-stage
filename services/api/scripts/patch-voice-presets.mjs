import fs from 'node:fs';
const R = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\";
function pf(p, fn) { let s = fs.readFileSync(p, 'utf8'); const o = fn(s); if (o !== s) { fs.writeFileSync(p, o); console.log('patched', p.split('\\').pop()); } }

// 音色预设列表 + 支持 preset/instruction 绑定
pf(R + 'routes\\characters.ts', (s) => {
  if (s.includes("'/voices'")) return s;
  let out = s.replace("export async function registerCharacterRoutes", `const VOICE_PRESETS = [
  { id: 'laozhou', label: '老周 · 低沉磁性（男）', instruction: '男声，五十岁左右，低沉磁性，语速偏慢，冷幽默' },
  { id: 'ali', label: '阿丽 · 明亮清脆（女）', instruction: '女声，二十五岁左右，明亮清脆，语速偏快，俏皮' },
  { id: 'dawei', label: '大伟 · 沉稳沙哑（男）', instruction: '男声，四十岁左右，沉稳沙哑，语速中等，严肃' },
  { id: 'qingnian', label: '青年 · 干净少年音（男）', instruction: '男声，二十二岁左右，干净少年音，语速轻快' },
  { id: 'wenrou', label: '温婉 · 成熟女声（女）', instruction: '女声，三十五岁左右，温婉成熟，语速平缓，亲和' }
];

export async function registerCharacterRoutes`);
  out = out.replace("  /** 角色音色绑定", `  app.get('/voices', async () => VOICE_PRESETS);

  /** 角色音色绑定`);
  return out;
});

// 绑定：preset 或 instruction
pf(R + 'routes\\characters.ts', (s) => {
  let out = s.replace("    const body = (req.body ?? {}) as { engine?: string; voice_id?: string };",
    "    const body = (req.body ?? {}) as { engine?: string; voice_id?: string; preset?: string; instruction?: string };");
  out = out.replace("    const voiceId = String(body.voice_id ?? (engine === 'breeze' ? 'breeze_role_' : 'v_host'));",
    "    const preset = VOICE_PRESETS.find((p) => p.id === body.preset);\n    const voiceId = String(body.voice_id ?? (preset ? 'breeze_' + preset.id : engine === 'breeze' ? 'breeze_role_' : 'v_host'));\n    const instruction = String(body.instruction ?? preset?.instruction ?? '');");
  out = out.replace("    if (existing) run('UPDATE voice_asset SET is_active = 1, provider = ?, role_id = ? WHERE id = ?', [engine, roleId, Number(existing.id)]);",
    "    if (existing) run('UPDATE voice_asset SET is_active = 1, provider = ?, role_id = ?, instruction = ? WHERE id = ?', [engine, roleId, instruction, Number(existing.id)]);");
  out = out.replace("    else run('INSERT INTO voice_asset (project_id, voice_id, role_id, provider, base_speed, available_emotions, is_active, created_at) VALUES (?,?,?,?,?,?,1,?)', [projectId, voiceId, roleId, engine, 1, '[]', nowIso()]);",
    "    else run('INSERT INTO voice_asset (project_id, voice_id, role_id, provider, base_speed, available_emotions, instruction, is_active, created_at) VALUES (?,?,?,?,?,?,?,1,?)', [projectId, voiceId, roleId, engine, 1, '[]', instruction, nowIso()]);");
  return out;
});
