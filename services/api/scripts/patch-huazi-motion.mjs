import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\media\\ffmpeg.ts";
let s = fs.readFileSync(p, 'utf8');
const start = s.indexOf('export async function overlayHuazi');
if (start < 0) { console.log('missing'); process.exit(1); }
const end = s.indexOf('\n}', start) + 2;
const fn = `export async function overlayHuazi(input: string, items: Array<{ path: string; start_ms: number; end_ms: number }>, out: string, width: number, height: number): Promise<{ ok: boolean; error?: string }> {
  if (items.length === 0) return { ok: false, error: 'no huazi' };
  const args: string[] = ['-y', '-i', input];
  const chains: string[] = ['[0:v]eq=saturation=1.06:contrast=1.04,vignette=PI/6[v0]'];
  let prev = '[v0]';
  items.forEach((it, i) => {
    const dur = Math.max(0.8, (it.end_ms - it.start_ms) / 1000);
    const startSec = (it.start_ms / 1000).toFixed(2);
    args.push('-loop', '1', '-t', String(dur + 0.6), '-i', it.path);
    const key = 'h' + i;
    chains.push('[' + (i + 1) + ':v]scale=' + Math.round(width * 0.92) + ':-2,format=rgba,fade=t=in:st=0:d=0.28:alpha=1,trim=duration=' + (dur + 0.5).toFixed(2) + '[' + key + ']');
    const next = '[v' + (i + 1) + ']';
    const xExpr = "if(lt(t," + (Number(startSec) + 0.45).toFixed(2) + "), W-(W-w)*(t-" + startSec + ")/0.45, (W-w)/2)";
    const yExpr = "H*0.06+10*sin(6*t)";
    chains.push(prev + '[' + key + ']overlay=x=\'' + xExpr + '\':y=\'' + yExpr + '\':enable=\'between(t,' + startSec + ',' + (it.start_ms / 1000 + dur).toFixed(2) + ')\'' + next);
    prev = next;
  });
  args.push('-filter_complex', chains.join(';'), '-map', prev, '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-shortest', out);
  return runFfmpeg(args);
}`;
s = s.slice(0, start) + fn + s.slice(end);
fs.writeFileSync(p, s);
console.log('animated overlay');
