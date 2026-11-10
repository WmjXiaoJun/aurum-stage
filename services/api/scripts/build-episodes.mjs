import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
const DATA = 'D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-data';
const API = 'http://127.0.0.1:8787/api/v1';
const FF = 'D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-stage/node_modules/.pnpm/ffmpeg-static@5.3.0/node_modules/ffmpeg-static/ffmpeg.exe';
const OUT = 'D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-stage/deliverables/season1';
const db = new DatabaseSync(DATA + '/aurum.db');
const project = db.prepare("select * from project where name like '玄枢%第一季' order by id desc limit 1").get();
const episodes = db.prepare('select * from season_episode where project_id = ? order by seq').all(project.id);
async function api(path, init) { const r = await fetch(API + path, init); const t = await r.text(); if (!r.ok) throw new Error(path + ' ' + r.status + ' ' + t.slice(0, 120)); return t ? JSON.parse(t) : null; }
function card(text, sub, seconds, out) {
  execFileSync(FF, ['-y', '-f', 'lavfi', '-i', 'color=c=0x0a0e13:s=1280x720:d=' + seconds, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-vf',
    "drawtext=fontfile='C\\:/Windows/Fonts/msyhbd.ttc':text='" + text + "':fontcolor=0xE8C87A:fontsize=92:x=(w-text_w)/2:y=(h-text_h)/2-40,drawtext=fontfile='C\\:/Windows/Fonts/msyh.ttc':text='" + sub + "':fontcolor=0xB8C4D6:fontsize=36:x=(w-text_w)/2:y=(h-text_h)/2+70",
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', out], { stdio: 'ignore' });
}
const bts = fs.readdirSync(OUT).filter(f => /^bts-\d+\.mp4$/.test(f)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0])).map(f => OUT + '/' + f);
const styleName = { anime_2d: '二维动画', cgi_3d: '三维动画', photoreal: '写实真人' };
for (const ep of episodes) {
  const intro = OUT + '/ep' + ep.seq + '-intro.mp4';
  card('第 ' + ep.seq + ' 期 · ' + (styleName[ep.visual_style] ?? ep.visual_style), '玄枢 · 深夜秀 第一季', 5, intro);
  const segs = db.prepare('select * from segment where episode_id = ? order by seq').all(ep.id);
  const parts = [intro];
  for (const seg of segs) {
    const res = await api('/projects/' + project.id + '/compose', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ segment_id: seg.id, bgm: true }) });
    const m = String(res.video_url ?? '').match(/assets\/(\d+)\/raw/);
    const vid = m ? Number(m[1]) : Number(res.video_asset_id ?? 0);
    const row = db.prepare('select * from asset where id = ?').get(vid) ?? db.prepare("select * from asset where project_id = ? and asset_type='video' and object_key like ? order by id desc limit 1").get(project.id, '%export/seg' + seg.id + '/%');
    if (row) parts.push(DATA + '/storage/assets/' + row.object_key);
  }
  const offset = ((ep.seq - 1) * 2) % Math.max(1, bts.length - 6);
  for (const clip of bts.slice(offset, offset + 6)) parts.push(clip);
  const outro = OUT + '/ep' + ep.seq + '-outro.mp4';
  card('下期见', '正片 + 幕后 · 全部自动生成', 5, outro);
  parts.push(outro);
  const list = OUT + '/ep' + ep.seq + '-list.txt';
  fs.writeFileSync(list, parts.map(f => "file '" + f + "'").join('\n'), 'utf8');
  const out = OUT + '/第' + ep.seq + '期-' + (styleName[ep.visual_style] ?? '') + '-完整版.mp4';
  execFileSync(FF, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out], { stdio: 'ignore' });
  console.log('EP', ep.seq, out, fs.statSync(out).size);
}
console.log('DONE');
