import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\adapters\\compose.ts";
let s = fs.readFileSync(p, 'utf8');
s = s.replace("  if (!ffmpegPath()) {\n    (manifest as Record<string, unknown>).huazi = huaziCount;\n  const manifestKey = baseKey + '/compose-manifest.json';",
  "  if (!ffmpegPath()) {\n    const manifestKey = baseKey + '/compose-manifest.json';");
s = s.replace("  const finalKey = outAbs.split(path.sep)", "  (manifest as Record<string, unknown>).huazi = huaziCount;\n  const finalKey = outAbs.split(path.sep)");
fs.writeFileSync(p, s);
console.log('manifest fixed');
