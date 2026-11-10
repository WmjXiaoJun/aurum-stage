import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\db\\index.ts";
let s = fs.readFileSync(p, 'utf8');
if (!s.includes("art_status")) {
  s = s.replace("  { table: 'project', column: 'auto_compose'", "  { table: 'character_asset', column: 'art_status', ddl: \"ALTER TABLE character_asset ADD COLUMN art_status TEXT NOT NULL DEFAULT 'none'\" },\n  { table: 'voice_asset', column: 'instruction', ddl: 'ALTER TABLE voice_asset ADD COLUMN instruction TEXT' },\n  { table: 'project', column: 'auto_compose'");
  fs.writeFileSync(p, s);
  console.log('migrations added');
} else console.log('already');
