import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
const DATA = 'D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-data';
const db = new DatabaseSync(DATA + '/aurum.db');
const ids = (process.env.DELETE_IDS ?? '').split(',').map((s) => Number(s.trim())).filter(Boolean);
console.log('delete projects', ids.join(','));
const tables = db.prepare("select name from sqlite_master where type='table'").all().map((r) => r.name);
const withProject = [];
for (const t of tables) {
  const cols = db.prepare('PRAGMA table_info(' + t + ')').all().map((c) => c.name);
  if (cols.includes('project_id')) withProject.push(t);
}
console.log('tables with project_id:', withProject.join(','));
let removedAssets = 0;
for (const id of ids) {
  const shotIds = db.prepare('select id from round_shot where project_id = ?').all(id).map((r) => r.id);
  for (const sid of shotIds) {
    for (const t of ['shot_candidate', 'shot_render', 'shot_note']) {
      if (tables.includes(t)) { try { db.prepare('delete from ' + t + ' where shot_id = ?').run(sid); } catch {} }
    }
  }
  for (const t of withProject) {
    try { db.prepare('delete from ' + t + ' where project_id = ?').run(id); } catch (e) { console.log('skip', t, String(e).slice(0, 80)); }
  }
  try { db.prepare('delete from project where id = ?').run(id); } catch (e) { console.log('project delete failed', id, String(e).slice(0, 80)); }
  const dir = DATA + '/storage/assets/projects/' + id;
  if (fs.existsSync(dir)) { fs.rmSync(dir, { recursive: true, force: true }); removedAssets += 1; }
}
const remaining = db.prepare('select id, name from project order by id').all();
console.log('remaining projects:', remaining.map((r) => r.id + ':' + r.name).join(' | '));
const size = (p) => { let s = 0; const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const q = d + '/' + f.name; if (f.isDirectory()) walk(q); else s += fs.statSync(q).size; } }; if (fs.existsSync(p)) walk(p); return Math.round(s / 1024 / 1024); };
console.log('storage MB after cleanup:', size(DATA + '/storage'));
try { db.exec('VACUUM'); } catch {}
console.log('done');
