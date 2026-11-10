import fs from 'node:fs';
const R = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\";
function pf(p, fn) { let s = fs.readFileSync(p, 'utf8'); const o = fn(s); if (o !== s) { fs.writeFileSync(p, o); console.log('patched', p.split('\\').pop()); } }

pf(R + 'db\\schema.ts', (s) => {
  if (s.includes('CREATE TABLE IF NOT EXISTS season_episode')) return s;
  return s.replace("CREATE TABLE IF NOT EXISTS segment (", `CREATE TABLE IF NOT EXISTS season_episode (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id     INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  seq            INTEGER NOT NULL,
  title          TEXT NOT NULL,
  brief          TEXT,
  template_key   TEXT,
  visual_style   TEXT NOT NULL DEFAULT 'photoreal',
  language       TEXT NOT NULL DEFAULT 'zh',
  status         TEXT NOT NULL DEFAULT 'draft',
  created_at     TEXT NOT NULL,
  UNIQUE (project_id, seq)
);

CREATE TABLE IF NOT EXISTS segment (`);
});

pf(R + 'db\\index.ts', (s) => {
  if (s.includes('episode_id')) return s;
  return s.replace("  { table: 'character_asset', column: 'art_status'",
    "  { table: 'segment', column: 'episode_id', ddl: 'ALTER TABLE segment ADD COLUMN episode_id INTEGER' },\n  { table: 'character_asset', column: 'art_status'");
});
