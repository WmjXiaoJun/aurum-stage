import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\routes\\\\characters.ts";
let s = fs.readFileSync(p, 'utf8');
if (!s.includes('presetVoice')) {
  s = s.replace("    const result = await synthesize({", "    const presetVoice = VOICE_PRESETS.find((p) => p.id === String((body as { preset?: string }).preset ?? ''));\n    const result = await synthesize({");
  s = s.replace("      voice_instruction: String(auditionVoice?.instruction ?? ''),", "      voice_instruction: String(presetVoice?.instruction ?? auditionVoice?.instruction ?? ''),");
  s = s.replace("      voice_id: String(body.voice_id ?? auditionVoice?.voice_id ?? 'v_host'),", "      voice_id: String(body.voice_id ?? (presetVoice ? 'breeze_' + presetVoice.id : auditionVoice?.voice_id) ?? 'v_host'),");
  s = s.replace("      engine: auditionEngine,", "      engine: presetVoice ? ('breeze' as const) : auditionEngine,");
  fs.writeFileSync(p, s);
  console.log('audition preset patched');
} else console.log('already');
