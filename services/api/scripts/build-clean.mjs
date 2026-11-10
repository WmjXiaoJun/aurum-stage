import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
const DATA = 'D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-data';
const API = 'http://127.0.0.1:8787/api/v1';
const FF = 'D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-stage/node_modules/.pnpm/ffmpeg-static@5.3.0/node_modules/ffmpeg-static/ffmpeg.exe';
const OUT = 'D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-stage/deliverables';
const db = new DatabaseSync(DATA + '/aurum.db');
const project = db.prepare("select * from project where name like '玄枢%第一季' order by id desc limit 1").get();
const ep = db.prepare('select * from season_episode where project_id = ? and visual_style = ? order by seq limit 1').get(project.id, 'photoreal');
console.log('episode', ep.id, ep.title);
function card(text, sub, seconds, out) {
  execFileSync(FF, ['-y', '-f', 'lavfi', '-i', 'color=c=0x07090d:s=1280x720:d=' + seconds, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-vf',
    "drawtext=fontfile='C\\:/Windows/Fonts/msyhbd.ttc':text='" + text + "':fontcolor=0xE8C87A:fontsize=96:x=(w-text_w)/2:y=(h-text_h)/2-40,drawtext=fontfile='C\\:/Windows/Fonts/msyh.ttc':text='" + sub + "':fontcolor=0x9FB0C6:fontsize=34:x=(w-text_w)/2:y=(h-text_h)/2+70",
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', out], { stdio: 'ignore' });
}
const intro = OUT + '/clean-intro.mp4';
const outro = OUT + '/clean-outro.mp4';
card('玄枢 · 深夜秀', '第 3 期 · 写实真人', 5, intro);
card('本期完', '玄枢 · AURUM', 4, outro);
const segs = db.prepare('select * from segment where episode_id = ? order by seq').all(ep.id);
const parts = [intro];
for (const seg of segs) {
  const res = await fetch(API + '/projects/' + project.id + '/compose', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ segment_id: seg.id, bgm: true }) });
  const j = await res.json();
  const key = String(j.video_url ?? '').match(/assets\/(\d+)\/raw/);
  const row = key ? db.prepare('select * from asset where id = ?').get(Number(key[1])) : null;
  console.log('seg', seg.id, j.duration_sec, row?.object_key);
  if (row) parts.push(DATA + '/storage/assets/' + row.object_key);
}
parts.push(outro);
const list = OUT + '/clean-list.txt';
fs.writeFileSync(list, parts.map(f => "file '" + f + "'").join('\n'), 'utf8');
const final = OUT + '/成片-第3期-写实-干净版.mp4';
execFileSync(FF, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', final], { stdio: 'ignore' });
console.log('FINAL', final, fs.statSync(final).size);
