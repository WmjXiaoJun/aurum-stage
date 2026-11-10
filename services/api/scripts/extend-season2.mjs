import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-data/aurum.db');
const now = new Date().toISOString();
const project = db.prepare("select * from project where name like '玄枢%第一季' order by id desc limit 1").get();
const episodes = db.prepare('select * from season_episode where project_id = ? order by seq').all(project.id);
const extra = {
  1: ['我们准备了三个问题，一个比一个难。','第一个问题：AI 会做梦吗？','第二个问题：它梦见的是谁？','第三个问题：它醒来会记得我们吗？','这些问题没有答案，但有反应。','反应，就是综艺。'],
  2: ['观众投票选一个最不像 AI 的答案。','我选第三个，因为它最不像人。','错了，第三个是我写的。','那你比 AI 还会演。','演，也是一种真诚。','这句话可以剪掉吗？'],
  3: ['如果这期播完，没人讨论，怎么办？','那就再做一期。','做到有人愿意停下来为止。','停下来之后呢？','之后，就聊点更难的。','比如：我们为什么需要被看见。']
};
const newIds = [];
for (const ep of episodes) {
  const segs = db.prepare('select * from segment where episode_id = ? order by seq').all(ep.id);
  const lines = extra[ep.seq] ?? [];
  lines.forEach((text, idx) => {
    const seg = segs[idx % segs.length];
    const seq = (db.prepare('select max(seq) s from round_shot where segment_id = ?').get(seg.id).s ?? 0) + 1;
    const role = idx % 2 === 0 ? 'host' : 'guest';
    const name = role === 'host' ? '老周' : '苏晚';
    const res = db.prepare('insert into round_shot (project_id, segment_id, seq, shot_code, speaker_role_id, speaker_name, camera, lines, text_clean, emotion, performance_tags, visual_prompt, negative_prompt, overlays, render_engine, visual_style, engine_params, tts_engine, voice_id, tts_speed, lipsync_required, native_audio, privacy, manual_edited, status, duration_ms, target_duration_ms, created_at, updated_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(project.id, seg.id, seq, 'Y' + ep.seq + '_' + seq, role === 'host' ? 'c_host' : 'c_guest', name, seq % 2 === 0 ? 'wide' : 'medium_shot',
        JSON.stringify([text]), text, role === 'host' ? 'friendly_smile' : 'excited', '[]',
        '深夜秀演播厅，暖色聚光与冷蓝霓虹对比，电影感构图，' + (ep.visual_style === 'anime_2d' ? '二维动画赛璐璐风格' : ep.visual_style === 'cgi_3d' ? '三维卡通渲染风格' : '写实真人电影质感') + ', no text, no signage lettering',
        '', '[]', 'muse_api', ep.visual_style, '{}', 'edge-tts', role === 'host' ? 'v_host' : 'v_guest', 1, 0, 0, 0, 1, 'empty', 9000, 9000, now, now);
    newIds.push(Number(res.lastInsertRowid));
  });
}
console.log(JSON.stringify({ projectId: project.id, added: newIds.length }));
console.log('NEW=' + JSON.stringify(newIds));
