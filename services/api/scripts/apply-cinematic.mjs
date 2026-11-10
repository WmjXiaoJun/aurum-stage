import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-data/aurum.db');
const { buildCinematicPrompt } = await import('../src/domain/cinematic-prompt.js');
const shots = db.prepare("select s.id, s.camera, s.speaker_name, s.visual_style, g.episode_id from round_shot s join segment g on g.id=s.segment_id where s.project_id=45 order by s.id").all();
let n = 0;
for (const s of shots) {
  const prompt = buildCinematicPrompt({ speaker: String(s.speaker_name ?? '老周'), camera: String(s.camera ?? 'medium_shot'), style: String(s.visual_style ?? 'photoreal'), index: Number(s.id) });
  db.prepare("update round_shot set visual_prompt=?, engine_params=json_set(COALESCE(engine_params,'{}'),'$.h3_prompt',?) where id=?").run(prompt, prompt, Number(s.id));
  n++;
}
console.log('prompts updated', n);
