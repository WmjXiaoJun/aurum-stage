import fs from 'node:fs';
const H = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\media\\huazi.ts";
let h = fs.readFileSync(H, 'utf8');
const start = h.indexOf('export function pickHuazi');
if (start > 0) {
  const end = h.indexOf('\n}', start) + 2;
  const fn = `export function pickHuazi(cues: Array<{ text: string; start_ms: number; end_ms: number }>, max = 8): HuaziItem[] {
  const styles: HuaziStyle[] = ['gold', 'pink', 'cyan', 'white'];
  const picked: HuaziItem[] = [];
  let last = -99999;
  for (const cue of cues) {
    const clean = cue.text.replace(/^[^：:]{1,8}[：:]/, '').replace(/[，。！？、,.!?“”"\s]/g, '');
    if (clean.length < 2) continue;
    if (cue.start_ms - last < 2200) continue;
    const phrase = clean.length > 7 ? clean.slice(0, 7) : clean;
    const style = styles[picked.length % styles.length];
    picked.push({ text: phrase, style, start_ms: cue.start_ms + 120, end_ms: Math.min(cue.end_ms + 900, cue.start_ms + 3200) });
    last = cue.start_ms;
    if (picked.length >= max) break;
  }
  return picked;
}`;
  h = h.slice(0, start) + fn + h.slice(end);
  fs.writeFileSync(H, h);
  console.log('pickHuazi replaced');
} else console.log('no pickHuazi');
const C = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\\\services\\\\api\\\\src\\\\adapters\\\\compose.ts";
let c = fs.readFileSync(C, 'utf8');
c = c.replace("const baseKey = assetKey('projects', input.project_id, 'export', input.task_id ?? 'manual');",
  "const baseKey = assetKey('projects', input.project_id, 'export', input.task_id ?? ('seg' + (input.segment_id ?? 'all')));");
fs.writeFileSync(C, c);
console.log('baseKey per segment');
