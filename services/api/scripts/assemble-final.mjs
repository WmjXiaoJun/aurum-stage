import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
const FF = 'D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-stage/node_modules/.pnpm/ffmpeg-static@5.3.0/node_modules/ffmpeg-static/ffmpeg.exe';
const DATA = 'D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-data';
const OUT = 'D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-stage/deliverables/season1';
const db = new DatabaseSync(DATA + '/aurum.db');

// 1) 每期两条段 → 一期
const epSegs = { 1: [82, 83], 2: [84, 85], 3: [86, 87] };
const epFiles = [];
for (const [seq, segIds] of Object.entries(epSegs)) {
  const parts = [];
  for (const id of segIds) {
    const row = db.prepare("select a.* from asset a where a.project_id=45 and a.asset_type='video' and a.source='compose' and a.object_key like ? order by a.id desc limit 1").get('%export/seg' + id + '/%');
    if (row) parts.push(DATA + '/storage/assets/' + row.object_key);
  }
  if (!parts.length) continue;
  const list = OUT + '/ep' + seq + '-parts.txt';
  fs.writeFileSync(list, parts.map(f => "file '" + f + "'").join('\n'), 'utf8');
  const out = OUT + '/ep' + seq + '-full.mp4';
  execFileSync(FF, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out], { stdio: 'ignore' });
  epFiles.push(out);
  console.log('ep', seq, out, fs.statSync(out).size);
}

// 2) 幕后集锦：角色/分镜/花字/看板 静帧 + 推拉
const stills = [
  ['D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-stage/shots/season-overview.png', '第 1 期 · 二维动画'],
  ['D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-stage/shots/ep2-big.jpg', '第 2 期 · 三维动画'],
  ['D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-stage/shots/ep3-final.jpg', '第 3 期 · 写实真人'],
  ['D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-data/storage/assets/projects/45/characters', '角色：自动立绘与音色'],
  ['D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-stage/shots/season-overview.png', '每期 10 镜，自动排期渲染'],
  ['D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-stage/shots/board.png', '批次看板：进度与出片'],
  ['D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-stage/shots/templates.png', '一个模板，三种画风'],
  ['D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-stage/shots/char-lib-filled.png', '角色库：自动补齐套图'],
  ['D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-stage/shots/huazi_test.png', '立体花字：可换色与动效']
];
const btsParts = [];
let i = 0;
for (const [src, cap] of stills) {
  let img = src;
  if (fs.statSync(src).isDirectory()) {
    const files = fs.readdirSync(src).filter(f => f.endsWith('.png'));
    if (!files.length) continue;
    img = src + '/' + files[0];
  }
  const clip = OUT + '/bts-' + i + '.mp4';
  const caption = cap.replace(/'/g, '');
  try {
    execFileSync(FF, ['-y', '-loop', '1', '-t', '22', '-i', img, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
      '-vf', "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0x0a0e13,zoompan=z='min(1.12,1+0.0006*on)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1280x720:fps=25,drawtext=fontfile='C\\:/Windows/Fonts/msyhbd.ttc':text='" + caption + "':fontcolor=0xE8C87A:fontsize=42:x=(w-text_w)/2:y=h-90:box=1:boxcolor=0x000000AA:boxborderw=14",
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip], { stdio: 'ignore' });
    btsParts.push(clip);
  } catch (e) { console.log('bts fail', img, String(e).slice(0, 120)); }
  i++;
}
let bts = null;
if (btsParts.length) {
  const list = OUT + '/bts.txt';
  fs.writeFileSync(list, btsParts.map(f => "file '" + f + "'").join('\n'), 'utf8');
  bts = OUT + '/bts.mp4';
  execFileSync(FF, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', bts], { stdio: 'ignore' });
  console.log('bts', bts, fs.statSync(bts).size);
}

// 3) 最终拼接
const finalFiles = [OUT + '/intro.mp4', ...epFiles, bts, OUT + '/outro.mp4'].filter(Boolean);
const fl = OUT + '/final-list.txt';
fs.writeFileSync(fl, finalFiles.map(f => "file '" + f + "'").join('\n'), 'utf8');
const final = OUT + '/season1-5min.mp4';
execFileSync(FF, ['-y', '-f', 'concat', '-safe', '0', '-i', fl, '-c', 'copy', final], { stdio: 'ignore' });
console.log('FINAL', final, fs.statSync(final).size);
