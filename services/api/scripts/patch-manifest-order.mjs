import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\adapters\\compose.ts";
let s = fs.readFileSync(p, 'utf8');
s = s.replace("  (manifest as Record<string, unknown>).deliverable = deliverable;\n  const manifestKey", "  const manifestKey");
if (!s.includes('manifest as Record<string, unknown>).deliverable')) {
  s = s.replace("  const videoAsset = createAsset({", "  (manifest as Record<string, unknown>).deliverable = deliverable;\n  const videoAsset = createAsset({");
}
fs.writeFileSync(p, s);
console.log('moved');
