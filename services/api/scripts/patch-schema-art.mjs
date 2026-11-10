import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\db\\\\schema.ts";
let s = fs.readFileSync(p, 'utf8');
if (!s.includes('art_status')) {
  s = s.replace("  anchor_prompt  TEXT,\n  authorization_file_hash TEXT,", "  anchor_prompt  TEXT,\n  art_status     TEXT NOT NULL DEFAULT 'none',\n  authorization_file_hash TEXT,");
  fs.writeFileSync(p, s);
  console.log('schema patched');
} else console.log('already');
