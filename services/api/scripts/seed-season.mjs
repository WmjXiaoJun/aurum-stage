import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
const DATA = 'D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-data';
const db = new DatabaseSync(DATA + '/aurum.db');
const now = new Date().toISOString();

// 1) 清空所有旧项目（级联）
db.exec('PRAGMA foreign_keys = ON');
const before = db.prepare('select count(*) n from project').get().n;
db.exec('DELETE FROM project');
console.log('deleted projects', before);

// 2) 新项目
const p = db.prepare("insert into project (name, variety_type, aspect_ratio, fps, visual_style, language, status, auto_compose, created_at, updated_at) values (?,?,?,?,?,?,?,?,?,?)")
  .run('玄枢 · 深夜秀 第一季', 'talk_show', '16:9', 25, 'photoreal', 'zh', 'draft', 1, now, now);
const projectId = Number(p.lastInsertRowid);

// 3) 三期：2D / 3D / 真人
const episodes = [
  { seq: 1, title: '第 1 期 · 二维动画', style: 'anime_2d', lines: [
    ['host', '老周', '欢迎来到玄枢深夜秀，这一期我们聊 AI 到底能不能当导演。'],
    ['guest', '苏晚', '能，但它只会拍安全的东西，安全是最不好看的。'],
    ['host', '老周', '那你敢让它剪一版吗？'],
    ['guest', '苏晚', '剪，剪完我们就知道谁该下班了。']
  ] },
  { seq: 2, title: '第 2 期 · 三维动画', style: 'cgi_3d', lines: [
    ['host', '老周', '上一期她被 AI 剪哭了，这一期她带了个 AI 助手来。'],
    ['guest', '苏晚', '它不哭，它只会算。'],
    ['host', '老周', '那让它算算我们这期能不能爆。'],
    ['guest', '苏晚', '算出来了：能，但得先把我这段删掉。']
  ] },
  { seq: 3, title: '第 3 期 · 写实真人', style: 'photoreal', lines: [
    ['host', '老周', '最后一期，我们不聊 AI 了，聊人。'],
    ['guest', '苏晚', '人最怕的不是被取代，是发现自己一直在演 AI。'],
    ['host', '老周', '这句话，得留到片尾。'],
    ['guest', '苏晚', '那就别剪，让它完整地疼一次。']
  ] }
];
const epIds = [];
for (const ep of episodes) {
  const r = db.prepare('insert into season_episode (project_id, seq, title, brief, template_key, visual_style, language, status, created_at) values (?,?,?,?,?,?,?,?,?)')
    .run(projectId, ep.seq, ep.title, '深夜秀三人对谈，聊 AI 与综艺导演', 'show_tonight_show', ep.style, 'zh', 'draft', now);
  epIds.push(Number(r.lastInsertRowid));
}

// 4) 角色（各期共用同一套主持人/嘉宾）
const chars = [
  { role: 'c_host', name: '老周', type: 'host', persona: '五十岁的深夜秀主持，低沉沙哑，冷幽默，话少但每句都扎人。' },
  { role: 'c_guest', name: '苏晚', type: 'guest', persona: '二十八岁的年轻女导演，清亮偏冷，语速快，敢拆台。' }
];
for (const c of chars) {
  db.prepare('insert into character_asset (project_id, role_id, version, name, role_type, persona, prompt_prefix, negative_extra, lock_seed, seed, is_active, anchor_prompt, art_status, created_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(projectId, c.role, 1, c.name, c.type, c.persona, c.type === 'host' ? 'middle-aged Chinese male host, short black hair, dark suit, glasses' : 'young Chinese female director, shoulder-length hair, black shirt', '', 1, c.name === '老周' ? 69381 : 53191, 1, '', 'none', now);
}

// 5) 段与镜头（每期 2 段 × 2 镜）
const shotRows = [];
for (let i = 0; i < episodes.length; i++) {
  const ep = episodes[i];
  const episodeId = epIds[i];
  const groups = [ep.lines.slice(0, 2), ep.lines.slice(2, 4)];
  groups.forEach((group, gi) => {
    const seg = db.prepare('insert into segment (project_id, episode_id, seq, segment_type, title, default_engine, duration_ms, created_at) values (?,?,?,?,?,?,?,?)')
      .run(projectId, episodeId, i * 2 + gi + 1, 'talk_round', gi === 0 ? '开场' : '交锋', 'muse_api', 12000, now);
    group.forEach((line, si) => {
      const [role, name, text] = line;
      const dur = 5200;
      const shot = db.prepare('insert into round_shot (project_id, segment_id, seq, shot_code, speaker_role_id, speaker_name, camera, lines, text_clean, emotion, performance_tags, visual_prompt, negative_prompt, overlays, render_engine, visual_style, engine_params, tts_engine, voice_id, tts_speed, lipsync_required, native_audio, privacy, manual_edited, status, duration_ms, target_duration_ms, created_at, updated_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(projectId, seg.lastInsertRowid, si + 1, 'E' + (i + 1) + 'S' + (gi + 1) + 'C' + (si + 1), role, name,
          si === 0 ? 'wide' : 'medium_shot', JSON.stringify([text]), text, role === 'host' ? 'friendly_smile' : 'excited', '[]',
          '深夜秀演播厅，暖色聚光与冷蓝霓虹对比，主持人桌与嘉宾沙发，电影感构图，' + (ep.style === 'anime_2d' ? '二维动画赛璐璐风格' : ep.style === 'cgi_3d' ? '三维卡通渲染风格' : '写实真人电影质感'),
          '', '[]', 'muse_api', ep.style, '{}', 'edge-tts', role === 'host' ? 'v_host' : 'v_guest', 1, 0, 0, 0, 1, 'empty', dur, dur, now, now);
      shotRows.push({ episode_id: episodeId, shot_id: Number(shot.lastInsertRowid), style: ep.style, text });
    });
  });
}

// 6) 老对象的资产目录清理
for (const dir of ['storage/assets/projects', 'exports']) {
  const abs = path.join(DATA, dir);
  if (fs.existsSync(abs)) { fs.rmSync(abs, { recursive: true, force: true }); fs.mkdirSync(abs, { recursive: true }); }
}
console.log(JSON.stringify({ projectId, episodes: epIds, shots: shotRows.length, shotIds: shotRows.map(s => s.shot_id) }));
console.log('SHOTS=' + JSON.stringify(shotRows));
