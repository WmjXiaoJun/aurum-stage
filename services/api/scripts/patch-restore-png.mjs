import fs from 'node:fs';
const F = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\media\\ffmpeg.ts";
let s = fs.readFileSync(F, 'utf8');
const start = s.indexOf('export async function overlayHuazi');
const end = s.indexOf('\n}', start) + 2;
const fn = String.raw`export async function overlayHuazi(input: string, items: Array<{ path: string; start_ms: number; end_ms: number }>, out: string, width: number, height: number): Promise<{ ok: boolean; error?: string }> {
  if (items.length === 0) return { ok: false, error: 'no huazi' };
  const args: string[] = ['-y', '-i', input];
  const chains: string[] = ['[0:v]eq=saturation=1.06:contrast=1.04,vignette=PI/6[v0]'];
  let prev = '[v0]';
  items.forEach((it, i) => {
    const dur = Math.max(0.8, (it.end_ms - it.start_ms) / 1000);
    const startSec = (it.start_ms / 1000).toFixed(2);
    args.push('-loop', '1', '-t', String(dur + 0.6), '-i', it.path);
    const key = 'h' + i;
    chains.push('[' + (i + 1) + ':v]colorkey=0x00b140:0.22:0.02,scale=' + Math.round(width * 0.92) + ':-2,format=rgba,trim=duration=' + (dur + 0.5).toFixed(2) + '[' + key + ']');
    const next = '[v' + (i + 1) + ']';
    const q = String.fromCharCode(39);
    const xExpr = 'if(lt(t,' + (Number(startSec) + 0.45).toFixed(2) + '), W-(W-w)*(t-' + startSec + ')/0.45, (W-w)/2)';
    const filt = '[' + key + ']overlay=x=' + q + xExpr + q + ':y=' + q + 'H*0.06+8*sin(6*t)' + q + ':enable=' + q + 'between(t,' + startSec + ',' + (it.start_ms / 1000 + dur).toFixed(2) + ')' + q;
    chains.push(prev + filt + next);
    prev = next;
  });
  args.push('-filter_complex', chains.join(';'), '-map', prev, '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-shortest', out);
  return runFfmpeg(args);
}`;
s = s.slice(0, start) + fn + s.slice(end);
fs.writeFileSync(F, s);

let c = fs.readFileSync("D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\adapters\\compose.ts", 'utf8');
const a = c.indexOf('      const rendered = items.map');
const b = c.indexOf('      if (rendered.length) {');
if (a >= 0 && b > a) {
  c = c.slice(0, a) + String.raw`      const rendered: Array<{ path: string; start_ms: number; end_ms: number }> = [];
      for (let i = 0; i < items.length; i++) {
        const hzPath = objectPath('assets', baseKey + '/huazi/' + i + '.png');
        const ok = await renderHuazi(items[i].text, items[i].style, hzPath);
        if (ok) rendered.push({ path: hzPath, start_ms: items[i].start_ms, end_ms: items[i].end_ms });
      }
` + c.slice(b);
  fs.writeFileSync(C, c);
}
console.log('png overlay restored');
