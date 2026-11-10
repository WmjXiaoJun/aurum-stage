import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\domain\\development-pack.ts";
let s = fs.readFileSync(p, 'utf8');
if (!s.includes('generatePlanArt')) {
  s = s.replace("import { generateCharacterArt } from '../adapters/character-art.js';", "import { generateCharacterArt } from '../adapters/character-art.js';\nimport { generatePlanArt } from '../adapters/asset-art.js';");
  s = s.replace("  let renderSubmitted = 0;", `  let planArt = 0;
  if (input.withArt !== false) {
    const items = (docs['variety-art'] as { items?: Array<Record<string, unknown>> }).items ?? [];
    try { const r = await generatePlanArt(projectId, items as never, 3); planArt = r.generated; } catch { /* 场景图失败不阻断 */ }
  }
  let renderSubmitted = 0;`);
  s = s.replace("created: { segments: segCount, shots: shotCount, characters: charCount, art: artCount, render_submitted: renderSubmitted }", "created: { segments: segCount, shots: shotCount, characters: charCount, art: artCount, plan_art: planArt, render_submitted: renderSubmitted }");
  s = s.replace("  created?: { segments: number; shots: number; characters: number; art?: number; render_submitted?: number };", "  created?: { segments: number; shots: number; characters: number; art?: number; plan_art?: number; render_submitted?: number };");
  fs.writeFileSync(p, s);
  console.log('plan art wired');
} else console.log('already');
