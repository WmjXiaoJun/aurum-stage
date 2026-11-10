import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\media\\ffmpeg.ts";
let s = fs.readFileSync(p, 'utf8');
const start = s.indexOf('export async function overlayHuazi');
const end = s.indexOf('\n}', start) + 2;
const fn = `export async function overlayHuazi(input: string, items: Array<{ text: string; style: string; start_ms: number; end_ms: number }>, out: string, width: number, height: number): Promise<{ ok: boolean; error?: string }> {
  if (items.length === 0) return { ok: false, error: 'no huazi' };
  const COLOR: Record<string, string> = { gold: '0xF2C14E', pink: '0xFF6AA9', cyan: '0x45D8E8', white: '0xFFFFFF' };
  const filters: string[] = ['[0:v]eq=saturation=1.06:contrast=1.04,vignette=PI/6[v0]'];
  let prev = '[v0]';
  items.forEach((it, i) => {
    const start = (it.start_ms / 1000).toFixed(2);
    const end = (it.end_ms / 1000).toFixed(2);
    const color = COLOR[it.style] ?? COLOR.gold;
    const size = it.text.length > 6 ? 92 : 110;
    const next = '[v' + (i + 1) + ']';
    const draw = 'drawtext=fontfile=' + String.fromCharCode(39) + 'C\\:/Windows/Fonts/msyhbd.ttc' + String.fromCharCode(39) +
      ':text=' + String.fromCharCode(39) + it.text.replace(/[':\\\\]/g, '') + String.fromCharCode(39) +
      ':fontcolor=' + color + ':fontsize=' + size +
      ':borderw=7:bordercolor=0x1A0B00@0.92' +
      ':shadowx=7:shadowy=7:shadowcolor=0x000000@0.45' +
      ':x=' + String.fromCharCode(39) + 'if(lt(t,' + (Number(start) + 0.45).toFixed(2) + '),W-(W-tw)*(t-' + start + ')/0.45,(w-tw)/2)' + String.fromCharCode(39) +
      ':y=' + String.fromCharCode(39) + 'h*0.07+8*sin(6*t)' + String.fromCharCode(39) +
      ':alpha=' + String.fromCharCode(39) + 'min(1,(t-' + start + ')/0.28)' + String.fromCharCode(39) +
      ':enable=' + String.fromCharCode(39) + 'between(t,' + start + ',' + end + ')' + String.fromCharCode(39);
    filters.push(prev + draw + next);
    prev = next;
  });
  const args = ['-y', '-i', input, '-filter_complex', filters.join(';'), '-map', prev, '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-shortest', out];
  return runFfmpeg(args);
}`;
s = s.slice(0, start) + fn + s.slice(end);
fs.writeFileSync(p, s);
console.log('drawtext overlay');
