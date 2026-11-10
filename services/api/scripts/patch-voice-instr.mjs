import fs from 'node:fs';
const R = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\";
function pf(p, fn) { let s = fs.readFileSync(p, 'utf8'); const o = fn(s); if (o !== s) { fs.writeFileSync(p, o); console.log('patched', p.split('\\').pop()); } }

// TTSSpec: voice_instruction，Breeze 用它
pf(R + 'adapters\\tts.ts', (s) => {
  let out = s.replace("  engine?: 'indextts2' | 'cosyvoice3' | 'fishspeech' | 'drama3' | 'breeze';", "  engine?: 'indextts2' | 'cosyvoice3' | 'fishspeech' | 'drama3' | 'breeze';\n  voice_instruction?: string;");
  out = out.replace("instruction: spec.emotion_instruction || undefined,", "instruction: spec.emotion_instruction || spec.voice_instruction || undefined,");
  return out;
});

// executor：把角色音色 instruction 带进 TTS
pf(R + 'scheduler\\executors.ts', (s) => {
  let out = s.replace("  const boundEngine = String(voiceRow?.provider ?? '') === 'breeze' ? ('breeze' as const) : undefined;",
    "  const boundEngine = String(voiceRow?.provider ?? '') === 'breeze' ? ('breeze' as const) : undefined;\n  const voiceInstruction = String(voiceRow?.instruction ?? '');");
  out = out.replace("    engine: boundEngine,", "    engine: boundEngine,\n    voice_instruction: voiceInstruction,");
  return out;
});

// 试音：带 instruction
pf(R + 'routes\\characters.ts', (s) => s.replace("      engine: auditionEngine,", "      engine: auditionEngine,\n      voice_instruction: String(auditionVoice?.instruction ?? ''),"));

// autopack：已有立绘就跳过 portrait
pf(R + 'domain\\character-autopack.ts', (s) => s.replace("    for (const kind of ['portrait', 'three_view', 'expressions'] as const) {\n      try {",
  "    for (const kind of ['portrait', 'three_view', 'expressions'] as const) {\n      if (kind === 'portrait' && get('SELECT id FROM character_ref_image WHERE character_id = ? LIMIT 1', [characterId])) continue;\n      try {"));

// 开发包：建角色后自动绑音色 + 后台补齐三视图/表情
pf(R + 'domain\\development-pack.ts', (s) => {
  if (s.includes('autoBindVoice')) return s;
  let out = s.replace("import { generatePlanArt } from '../adapters/asset-art.js';", "import { generatePlanArt } from '../adapters/asset-art.js';\nimport { autoBindVoice, autoGenerateArtPack } from './character-autopack.js';");
  out = out.replace("      try { const r = await generateCharacterArt({ character_id: cid, modes: ['portrait'], count: 1, style: styleOf(projectId) }); artCount += r.assets.length; } catch { /* 单张失败不影响流水线 */ }",
    "      try { const r = await generateCharacterArt({ character_id: cid, modes: ['portrait'], count: 1, style: styleOf(projectId) }); artCount += r.assets.length; } catch { /* 单张失败不影响流水线 */ }\n      try { await autoBindVoice(cid); } catch { /* 音色推断失败不影响 */ }\n      void autoGenerateArtPack(cid);");
  return out;
});
