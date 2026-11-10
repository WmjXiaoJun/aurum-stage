import { DatabaseSync } from 'node:sqlite';
const DATA = 'D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-data';
const db = new DatabaseSync(DATA + '/aurum.db');
const keyRow = db.prepare("select api_keys from llm_provider where provider_key='deepseek' limit 1").get();
let key = '';
try { const arr = JSON.parse(keyRow?.api_keys ?? '[]'); key = Array.isArray(arr) ? String(arr[0] ?? '') : String(keyRow?.api_keys ?? ''); } catch { key = String(keyRow?.api_keys ?? ''); }
const project = db.prepare("select * from project where name like '玄枢%第一季' order by id desc limit 1").get();
const episodes = db.prepare('select * from season_episode where project_id = ? order by seq').all(project.id);
const promptFor = (ep, n) => '为中文深夜秀写 ' + n + ' 句对白，严格输出 JSON 数组，每项 {"role":"host"|"guest","text":"..."}。主持人是 50 岁冷幽默男主持老周，嘉宾是 28 岁犀利女导演苏晚。主题：AI 与综艺导演、真实与表演。要求：每句 10–28 个汉字，口语、有来有回、有笑点和反转，不要写镜头说明，不要重复。';
async function gen(ep, n) {
  if (!key) return null;
  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify({ model: 'deepseek-chat', temperature: 0.9, messages: [{ role: 'system', content: '你是综艺编剧，只输出 JSON。' }, { role: 'user', content: promptFor(ep, n) }] }) });
    const data = JSON.parse(await res.text());
    const content = String(data.choices?.[0]?.message?.content ?? '');
    const m = content.match(/\[[\s\S]*\]/);
    if (!m) return null;
    return JSON.parse(m[0]);
  } catch { return null; }
}
function fallback(n) {
  const hosts = ['我们再把问题往前推一步。','这句话我不同意。','那你告诉我，人到底强在哪？','观众会替我们回答。','别急着下结论。','我们放一段素材看看。','这段我看了三遍。','你觉得它好在哪？','说说你真正的担心。','如果明天就失业呢？'];
  const guests = ['强在会犹豫。','AI 不会犹豫，所以它不可爱。','我担心的是没人再认真看。','失业不可怕，可怕的是没人在乎。','它算得对，但它不算人。','我宁愿慢一点。','慢工出细活，人也一样。','我把话放这。','这不是技术问题。','这是愿不愿意的问题。'];
  const out = [];
  for (let i = 0; i < n; i++) out.push({ role: i % 2 === 0 ? 'host' : 'guest', text: i % 2 === 0 ? hosts[i % hosts.length] : guests[i % guests.length] });
  return out;
}
const allNew = [];
for (const ep of episodes) {
  const existing = db.prepare("select count(*) n from round_shot s join segment g on g.id=s.segment_id where g.episode_id=?").get(ep.id).n;
  const need = Math.max(0, 45 - existing);
  if (need === 0) { console.log('ep', ep.seq, 'already 45'); continue; }
  let lines = await gen(ep, need);
  if (!Array.isArray(lines) || lines.length < need) lines = fallback(need);
  const now = new Date().toISOString();
  const segs = db.prepare('select * from segment where episode_id = ? order by seq').all(ep.id);
  lines.slice(0, need).forEach((line, idx) => {
    const seg = segs[idx % segs.length];
    const seq = (db.prepare('select max(seq) s from round_shot where segment_id = ?').get(seg.id).s ?? 0) + 1;
    const role = line.role === 'guest' ? 'guest' : 'host';
    const res = db.prepare('insert into round_shot (project_id, segment_id, seq, shot_code, speaker_role_id, speaker_name, camera, lines, text_clean, emotion, performance_tags, visual_prompt, negative_prompt, overlays, render_engine, visual_style, engine_params, tts_engine, voice_id, tts_speed, lipsync_required, native_audio, privacy, manual_edited, status, duration_ms, target_duration_ms, created_at, updated_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(project.id, seg.id, seq, 'Z' + ep.seq + '_' + seq, role === 'host' ? 'c_host' : 'c_guest', role === 'host' ? '老周' : '苏晚', seq % 3 === 0 ? 'wide' : 'medium_shot',
        JSON.stringify([String(line.text)]), String(line.text), role === 'host' ? 'friendly_smile' : 'excited', '[]',
        '深夜秀演播厅，暖色聚光与冷蓝霓虹对比，电影感构图，' + (ep.visual_style === 'anime_2d' ? '二维动画赛璐璐风格' : ep.visual_style === 'cgi_3d' ? '三维卡通渲染风格' : '写实真人电影质感') + ', no text, no captions, no signage lettering, no logos',
        '', '[]', 'muse_api', ep.visual_style, '{}', 'edge-tts', role === 'host' ? 'v_host' : 'v_guest', 1, 0, 0, 0, 1, 'empty', 9000, 9000, now, now);
    allNew.push(Number(res.lastInsertRowid));
  });
  console.log('ep', ep.seq, 'added', Math.min(lines.length, need));
}
console.log('NEW=' + JSON.stringify(allNew));
