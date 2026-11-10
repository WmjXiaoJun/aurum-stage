import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\adapters\\\\compose.ts";
let s = fs.readFileSync(p, 'utf8');
if (!s.includes('pickHuazi')) {
  s = s.replace("import { burnAss, concatClips, normalizeClip, muxAudio, addBgm, probeDuration } from '../media/ffmpeg.js';",
    "import { burnAss, concatClips, normalizeClip, muxAudio, addBgm, probeDuration, overlayHuazi } from '../media/ffmpeg.js';\nimport { pickHuazi, renderHuazi } from '../media/huazi.js';");
  s = s.replace("  const burn = await burnAss(mixedPath, objectPath('assets', assKey), finalAbs);",
`  const burn = await burnAss(mixedPath, objectPath('assets', assKey), finalAbs);
  let huaziCount = 0;
  let outWithHuazi: string | null = null;
  try {
    const items = pickHuazi(plan.cues, 6);
    if (items.length && burn.ok) {
      const rendered: Array<{ path: string; start_ms: number; end_ms: number }> = [];
      for (let i = 0; i < items.length; i++) {
        const hzPath = objectPath('assets', baseKey + '/huazi/' + i + '.png');
        const ok = await renderHuazi(items[i].text, items[i].style, hzPath);
        if (ok) rendered.push({ path: hzPath, start_ms: items[i].start_ms, end_ms: items[i].end_ms });
      }
      if (rendered.length) {
        const huaziOut = objectPath('assets', baseKey + '/final_huazi.mp4');
        const r = await overlayHuazi(finalAbs, rendered, huaziOut, plan.width, plan.height);
        if (r.ok && fs.existsSync(huaziOut)) { outWithHuazi = huaziOut; huaziCount = rendered.length; }
      }
    }
  } catch { /* 花字失败不影响字幕成片 */ }`);
  s = s.replace("  const outAbs = burn.ok && fs.existsSync(finalAbs) ? finalAbs : mixedPath;",
    "  const outAbs = outWithHuazi ?? (burn.ok && fs.existsSync(finalAbs) ? finalAbs : mixedPath);");
  s = s.replace("    meta: { kind: 'final', cues: plan.cues.length, subtitles: true,", "    meta: { kind: 'final', cues: plan.cues.length, subtitles: true, huazi: huaziCount,");
  s = s.replace("    cues: plan.cues,", "    cues: plan.cues,\n    huazi: huaziCount,");
  fs.writeFileSync(p, s);
  console.log('compose huazi wired');
} else console.log('already');
