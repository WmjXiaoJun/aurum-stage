import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\domain\\development-pack.ts";
let s = fs.readFileSync(p, 'utf8');
// 1) 增加两个视觉技能步骤
s = s.replace("  { key: 'variety-storyboard', name: '分镜表' }\n];", "  { key: 'variety-storyboard', name: '分镜表' },\n  { key: 'variety-art', name: '视觉资产计划' },\n  { key: 'variety-refs', name: '角色一致性参考' }\n];");
// 2) 落库后：生成角色立绘 + 提交渲染
s = s.replace("  return { ok: true, stopped_at: null, steps, created: { segments: segCount, shots: shotCount, characters: charCount } };",
`  // ---- 自动补角色立绘 + 提交渲染 ----
  const createdCharacters = all('SELECT id FROM character_asset WHERE project_id = ? AND is_active = 1', [projectId]).map((r) => Number(r.id));
  let artCount = 0;
  if (input.withArt !== false) {
    for (const cid of createdCharacters) {
      const has = get('SELECT id FROM character_ref_image WHERE character_id = ? LIMIT 1', [cid]);
      if (has) continue;
      try { const r = await generateCharacterArt({ character_id: cid, modes: ['portrait'], count: 1, style: styleOf(projectId) }); artCount += r.assets.length; } catch { /* 单张失败不影响流水线 */ }
    }
  }
  let renderSubmitted = 0;
  if (input.withRender !== false) {
    const limit = Math.max(1, Math.min(30, Number(input.render_limit ?? 8)));
    const shotsToRender = all('SELECT id FROM round_shot WHERE project_id = ? ORDER BY segment_id, seq LIMIT ?', [projectId, limit]);
    for (const srow of shotsToRender) {
      try { submitShotRender(Number(srow.id), { force: true, candidates: 1 }); renderSubmitted += 1; } catch { /* 时长超限等跳过 */ }
    }
  }

  return { ok: true, stopped_at: null, steps, created: { segments: segCount, shots: shotCount, characters: charCount, art: artCount, render_submitted: renderSubmitted } };`);
// 3) 引入依赖 + 参数
s = s.replace("import { notFound } from '../http/errors.js';", "import { notFound } from '../http/errors.js';\nimport { generateCharacterArt } from '../adapters/character-art.js';\nimport { submitShotRender } from '../scheduler/task-service.js';");
s = s.replace("export async function runDevelopmentPack(projectId: number, brief: string): Promise<PackResult> {", "export interface PackOptions { withArt?: boolean; withRender?: boolean; render_limit?: number }\n\nfunction styleOf(projectId: number): string { return String(get('SELECT visual_style FROM project WHERE id = ?', [projectId])?.visual_style ?? 'photoreal'); }\n\nexport async function runDevelopmentPack(projectId: number, brief: string, input: PackOptions = {}): Promise<PackResult> {");
s = s.replace("  created?: { segments: number; shots: number; characters: number };", "  created?: { segments: number; shots: number; characters: number; art?: number; render_submitted?: number };");
fs.writeFileSync(p, s);
console.log('pack extended');
