import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\adapters\\asset-art.ts";
let s = fs.readFileSync(p, 'utf8');
s = s.replace("const buf = Buffer.from(new Uint8Array(await comfyFetch(view).then((r) => r.arrayBuffer())));",
  "const ab = await comfyFetch(view).then((r) => r.arrayBuffer());\n    const buf = Buffer.from(ab as ArrayBuffer);");
fs.writeFileSync(p, s);
console.log('fixed2');
