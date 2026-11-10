import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\routes\\characters.ts";
let s = fs.readFileSync(p, 'utf8');
if (!s.includes("provider ?? '') === 'breeze'")) {
  s = s.replace("    const result = await synthesize({", "    const auditionVoice = get('SELECT provider, voice_id FROM voice_asset WHERE project_id = ? AND role_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1', [character.project_id, String(character.role_id)]);\n    const auditionEngine = String(auditionVoice?.provider ?? '') === 'breeze' ? ('breeze' as const) : undefined;\n    const result = await synthesize({");
  s = s.replace("      voice_id: String(body.voice_id ?? 'v_host'),", "      voice_id: String(body.voice_id ?? auditionVoice?.voice_id ?? 'v_host'),\n      engine: auditionEngine,");
  fs.writeFileSync(p, s);
  console.log('audition patched');
} else console.log('already');
