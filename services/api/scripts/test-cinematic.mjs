import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-data/aurum.db');
const { buildCinematicPrompt } = await import('../src/domain/cinematic-prompt.js');
const shot = db.prepare("select s.*, g.episode_id from round_shot s join segment g on g.id=s.segment_id where s.id=1123").get();
const prompt = buildCinematicPrompt({ speaker: shot.speaker_name, camera: shot.camera, style: shot.visual_style, index: Number(shot.id) });
db.prepare('update round_shot set visual_prompt=?, status=?, error_code=null where id=?').run(prompt, 'empty', 1123);
console.log(prompt);
const res = await fetch('http://127.0.0.1:8787/api/v1/shots/1123/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force: true, candidates: 1 }) });
console.log('render', res.status);
