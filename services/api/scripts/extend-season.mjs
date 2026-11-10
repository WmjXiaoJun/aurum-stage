import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-data/aurum.db');
const now = new Date().toISOString();
const project = db.prepare("select * from project where name like '玄枢%第一季' order by id desc limit 1").get();
const episodes = db.prepare('select * from season_episode where project_id = ? order by seq').all(project.id);
const extra = {
  1: [['host','老周','我们先做个实验：同一段素材，让人和 AI 各剪一版。'],['guest','苏晚','我赌 AI 剪得更顺，但人会剪得更狠。'],['host','老周','那观众到底要顺，还是要狠？'],['guest','苏晚','要真。顺和狠都是技巧，真才是命。'],['host','老周','这句话我记下了，留给片尾。'],['guest','苏晚','别留，留了就假了。']],
  2: [['host','老周','它算出来我们这期能爆，但它没算到你会拆台。'],['guest','苏晚','拆台才是综艺的呼吸。'],['host','老周','那让它也呼吸一下。'],['guest','苏晚','它没有肺，只有参数。'],['host','老周','参数也能写出人话吗？'],['guest','苏晚','能，只要它先学会闭嘴听。']],
  3: [['host','老周','最后一期了，说点不会被剪掉的。'],['guest','苏晚','那就说：我们怕的不是 AI，是没人再认真看。'],['host','老周','你这话，观众会记很久。'],['guest','苏晚','记多久都行，别快进。'],['host','老周','好，那我们慢一点收尾。'],['guest','苏晚','慢一点，才像人。']]
};
const newShots = [];
for (const ep of episodes) {
  const segs = db.prepare('select * from segment where episode_id = ? order by seq').all(ep.id);
  db.prepare('update round_shot set duration_ms = 9500, target_duration_ms = 9500 where project_id = ? and segment_id in (select id from segment where episode_id = ?)').run(project.id, ep.id);
  const lines = extra[ep.seq] ?? [];
  lines.forEach((line, idx) => {
    const seg = segs[idx % segs.length];
    const [role, name, text] = line;
    const seq = (db.prepare('select max(seq) s from round_shot where segment_id = ?').get(seg.id).s ?? 0) + 1;
    const res = db.prepare('insert into round_shot (project_id, segment_id, seq, shot_code, speaker_role_id, speaker_name, camera, lines, text_clean, emotion, performance_tags, visual_prompt, negative_prompt, overlays, render_engine, visual_style, engine_params, tts_engine, voice_id, tts_speed, lipsync_required, native_audio, privacy, manual_edited, status, duration_ms, target_duration_ms, created_at, updated_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(project.id, seg.id, seq, 'X' + ep.seq + '_' + seq, role, name, seq % 2 === 0 ? 'wide' : 'medium_shot',
        JSON.stringify([text]), text, role === 'host' ? 'friendly_smile' : 'excited', '[]',
        '深夜秀演播厅，暖色聚光与冷蓝霓虹对比，电影感构图，' + (ep.visual_style === 'anime_2d' ? '二维动画赛璐璐风格' : ep.visual_style === 'cgi_3d' ? '三维卡通渲染风格' : '写实真人电影质感'),
        '', '[]', 'muse_api', ep.visual_style, '{}', 'edge-tts', role === 'host' ? 'v_host' : 'v_guest', 1, 0, 0, 0, 1, 'empty', 9500, 9500, now, now);
    newShots.push(Number(res.lastInsertRowid));
  });
}
const count = db.prepare('select count(*) n from round_shot where project_id = ?').get(project.id).n;
console.log(JSON.stringify({ projectId: project.id, added: newShots.length, totalShots: count }));
console.log('NEW=' + JSON.stringify(newShots));
