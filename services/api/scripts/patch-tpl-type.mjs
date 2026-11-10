import fs from 'node:fs';
const W = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\web\\src\\";
function pf(rel, fn) { const p = W + rel; let s = fs.readFileSync(p, 'utf8'); const o = fn(s); if (o !== s) { fs.writeFileSync(p, o); console.log('patched', rel); } }
pf('lib\\zh.ts', (s) => s.replace("  variety_show: '综艺形态',", "  variety_show: '综艺形态',\n  engineering_template: '工程模板',"));
pf('lib\\types.ts', (s) => s.replace("template_type: 'muse_api' | 'comfy_workflow' | 'tts_preset' | 'variety_show';", "template_type: 'muse_api' | 'comfy_workflow' | 'tts_preset' | 'variety_show' | 'engineering_template';"));
pf('pages\\Templates.tsx', (s) => s.replace("  { id: 'variety_show', label: '综艺形态' }\n];", "  { id: 'variety_show', label: '综艺形态' },\n  { id: 'engineering_template', label: '工程模板' }\n];"));
