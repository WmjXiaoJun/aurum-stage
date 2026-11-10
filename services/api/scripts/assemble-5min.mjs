import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const DATA = 'D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-data';
const API = 'http://127.0.0.1:8787/api/v1';
const FF = 'D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-stage/node_modules/.pnpm/ffmpeg-static@5.3.0/node_modules/ffmpeg-static/ffmpeg.exe';
const OUT = 'D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-stage/deliverables/season1';
const db = new DatabaseSync(DATA + '/aurum.db');
const project = db.prepare("select * from project where name like '玄枢%第一季' order by id desc limit 1").get();
const episodes = db.prepare('select * from season_episode where project_id = ? order by seq').all(project.id);
fs.mkdirSync(OUT, { recursive: true });
async function api(path, init) { const r = await fetch(API + path, init); const t = await r.text(); if (!r.ok) throw new Error(path + ' ' + r.status + ' ' + t.slice(0, 120)); return t ? JSON.parse(t) : null; }

// 片头 / 片尾
function card(text, sub, seconds, out) {
  execFileSync(FF, ['-y', '-f', 'lavfi', '-i', 'color=c=0x0a0e13:s=1280x720:d=' + seconds, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-vf',
    "drawtext=fontfile='C\\:/Windows/Fonts/msyhbd.ttc':text='" + text + "':fontcolor=0xE8C87A:fontsize=104:x=(w-text_w)/2:y=(h-text_h)/2-50,drawtext=fontfile='C\\:/Windows/Fonts/msyh.ttc':text='" + sub + "':fontcolor=0xB8C4D6:fontsize=38:x=(w-text_w)/2:y=(h-text_h)/2+80",
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', out], { stdio: 'ignore' });
}
card('玄枢 · 深夜秀', '第一季 · 五分钟整体效果', 8, OUT + '/intro.mp4');
card('第一季 · 完', '同一个模板 · 三种画风 · 全部自动生成', 6, OUT + '/outro.mp4');

const files = [OUT + '/intro.mp4'];
for (const ep of episodes) {
  const segs = db.prepare('select * from segment where episode_id = ? order by seq').all(ep.id);
  const parts = [];
  for (const seg of segs) {
    const res = await api('/projects/' + project.id + '/compose', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ segment_id: seg.id, bgm: true }) });
    const row = db.prepare('select * from asset where id = ?').get(res.video_asset_id ?? 0);
    if (row) parts.push(DATA + '/storage/assets/' + row.object_key);
    console.log('seg', seg.id, 'huazi', res.manifest?.huazi);
  }
  if (parts.length === 0) continue;
  const list = OUT + '/ep' + ep.seq + '-parts.txt';
  fs.writeFileSync(list, parts.map(f => "file '" + f.replace(/'/g, "'\\''") + "'").join('\n'), 'utf8');
  const epFile = OUT + '/ep' + ep.seq + '-full.mp4';
  execFileSync(FF, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', epFile], { stdio: 'ignore' });
  files.push(epFile);
  console.log('EP', ep.seq, epFile);
}
files.push(OUT + '/outro.mp4');
const finalList = OUT + '/final.txt';
fs.writeFileSync(finalList, files.map(f => "file '" + f.replace(/'/g, "'\\''") + "'").join('\n'), 'utf8');
const final = OUT + '/season1-5min.mp4';
execFileSync(FF, ['-y', '-f', 'concat', '-safe', '0', '-i', finalList, '-c', 'copy', final], { stdio: 'ignore' });
const probe = execFileSync(FF, ['-i', final], { stdio: ['ignore', 'ignore', 'pipe'] }).toString();
console.log('FINAL', final, fs.statSync(final).size);
process.exit(0);
