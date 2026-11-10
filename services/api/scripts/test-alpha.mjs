import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const html = 'D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-stage/shots/alpha.html';
fs.writeFileSync(html, '<html><body style="margin:0;background:transparent"><div style="font:900 120px Microsoft YaHei;color:#ff6aa9;-webkit-text-stroke:5px #4d0a2a">测试</div></body></html>');
const out = 'D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-stage/shots/alpha.png';
for (const mode of ['--headless=new', '--headless=old']) {
  try {
    execFileSync(CH, [mode, '--disable-gpu', '--default-background-color=00000000', '--window-size=600,300', '--screenshot=' + out, 'file:///' + html.replace(/\\/g, '/')], { stdio: 'ignore' });
    const info = execFileSync('D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-stage/node_modules/.pnpm/ffmpeg-static@5.3.0/node_modules/ffmpeg-static/ffmpeg.exe', ['-v', 'error', '-i', out, '-vf', 'alphaextract,format=gray', '-f', 'rawvideo', '-'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let max = 0;
    for (const b of info) if (b > max) max = b;
    console.log(mode, 'alpha max', max, 'bytes', info.length);
  } catch (e) { console.log(mode, 'fail', String(e).slice(0, 80)); }
}
