import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\adapters\\compose.ts";
let s = fs.readFileSync(p, 'utf8');
s = s.replace("import { ffmpegPath, burnAss, concatClips, mixAudio, normalizeClip, renderCardClip } from '../media/ffmpeg.js';",
  "import { ffmpegPath, burnAss, concatClips, mixAudio, normalizeClip, renderCardClip, overlayHuazi } from '../media/ffmpeg.js';\nimport { pickHuazi, renderHuazi } from '../media/huazi.js';");
s = s.replace("    huazi: huaziCount,\n", "");
s = s.replace("  const manifestKey = baseKey + '/compose-manifest.json';", "  (manifest as Record<string, unknown>).huazi = huaziCount;\n  const manifestKey = baseKey + '/compose-manifest.json';");
fs.writeFileSync(p, s);
console.log('imports fixed');
