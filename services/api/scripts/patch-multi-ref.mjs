import fs from 'node:fs';
const R = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\";
function pf(p, fn) { let s = fs.readFileSync(p, 'utf8'); const o = fn(s); if (o !== s) { fs.writeFileSync(p, o); console.log('patched', p.split('\\').pop()); } }

// 角色图：加负面词，压掉文字/贴纸伪影
pf(R + 'adapters\\character-art.ts', (s) => {
  let out = s.replace(
    "  photoreal: { ckpt: 'RealVisXL_V5.0_fp16.safetensors', steps: 24, cfg: 5.5, sampler: 'dpmpp_2m', negative: 'cartoon, anime, 3d, extra fingers, deformed, text, watermark, logo, two different people' },",
    "  photoreal: { ckpt: 'RealVisXL_V5.0_fp16.safetensors', steps: 24, cfg: 5.5, sampler: 'dpmpp_2m', negative: 'cartoon, anime, 3d, extra fingers, deformed, text, watermark, logo, ui, screen, badge, sticker, two different people' },"
  );
  out = out.replace(
    "  cgi_3d: { ckpt: 'DreamShaperXL_Turbo_v2_1.safetensors', steps: 8, cfg: 2.2, sampler: 'dpmpp_sde', negative: 'photo, flat 2d, sketch, text, watermark, logo, deformed, two different people' },",
    "  cgi_3d: { ckpt: 'DreamShaperXL_Turbo_v2_1.safetensors', steps: 8, cfg: 2.2, sampler: 'dpmpp_sde', negative: 'photo, realistic, flat 2d, sketch, text, watermark, logo, ui, screen, badge, sticker, deformed, two different people' },"
  );
  out = out.replace("prompt: 'character concept art, upper body portrait, front view, looking at camera, clean light gray background, soft studio lighting, highly detailed face, solo, same character', width: 768, height: 1024, ipWeight: 0.7, neg: 'full body, multiple people, collage'",
    "prompt: 'character concept art, upper body portrait, front view, looking at camera, clean plain background, soft studio lighting, highly detailed face, solo, same character, no text, no logo, no badge', width: 768, height: 1024, ipWeight: 0.7, neg: 'full body, multiple people, collage, text, logo, badge, ui, screen'");
  return out;
});

// 多人同框：executor 里合成 2–3 人参考 + 提示词前缀
pf(R + 'scheduler\\executors.ts', (s) => {
  if (s.includes('composeMultiReference')) return s;
  let out = s.replace("import { generateWithComfy, generateWithMuse, type VideoSpec } from '../adapters/video.js';",
    "import { generateWithComfy, generateWithMuse, type VideoSpec } from '../adapters/video.js';\nimport { composeMultiReference } from '../adapters/multi-ref.js';");
  out = out.replace("  const spec: VideoSpec = {", `  // 多人同框：中景/全景且项目有 ≥2 个角色时，把两个角色参考图拼成首帧
  let multiPromptPrefix = '';
  let referencePath = characterRefPath(Number(task.project_id), shot.speaker_role_id == null ? null : String(shot.speaker_role_id));
  try {
    const camera = String(shot.camera ?? '');
    const characters = all('SELECT id FROM character_asset WHERE project_id = ? AND is_active = 1 ORDER BY id LIMIT 3', [Number(task.project_id)]);
    if (characters.length >= 2 && ['wide', 'medium_shot'].includes(camera)) {
      const paths: string[] = [];
      for (const c of characters) {
        const ref = get("SELECT a.bucket, a.object_key FROM character_ref_image r JOIN asset a ON a.id = r.asset_id WHERE r.character_id = ? ORDER BY r.id LIMIT 1", [Number(c.id)]);
        if (ref) paths.push(objectPath(String(ref.bucket), String(ref.object_key)));
      }
      const composite = objectPath('assets', assetKey('projects', Number(task.project_id), 'multi_ref', Number(shot.id) + '.jpg'));
      if (await composeMultiReference(paths, composite)) {
        referencePath = composite;
        multiPromptPrefix = (paths.length >= 3 ? 'three people in frame, ' : 'two people in frame, ') + 'conversation, cinematic two-shot, ';
      }
    }
  } catch { /* 多人合成失败就用单人参考 */ }

  const spec: VideoSpec = {`);
  out = out.replace("    prompt: String(shot.visual_prompt ?? ''),", "    prompt: multiPromptPrefix + String(shot.visual_prompt ?? ''),");
  out = out.replace("    reference_image_path: characterRefPath(Number(task.project_id), shot.speaker_role_id == null ? null : String(shot.speaker_role_id))", "    reference_image_path: referencePath");
  return out;
});
