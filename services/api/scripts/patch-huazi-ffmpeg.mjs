import fs from 'node:fs';
const R = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\";
function pf(p, fn) { let s = fs.readFileSync(p, 'utf8'); const o = fn(s); if (o !== s) { fs.writeFileSync(p, o); console.log('patched', p.split('\\').pop()); } }

// 透明底不可靠 → 用纯绿底 + colorkey
pf(R + 'media\\huazi.ts', (s) => s
  .replace("html,body{margin:0;background:transparent;", "html,body{margin:0;background:#00b140;")
  .replace("body{display:flex;align-items:center;justify-content:center}", "body{display:flex;align-items:center;justify-content:center;background:#00b140}")
);

// ffmpeg 叠加花字
pf(R + 'media\\ffmpeg.ts', (s) => {
  if (s.includes('overlayHuazi')) return s;
  return s + `
export async function overlayHuazi(input: string, items: Array<{ path: string; start_ms: number; end_ms: number }>, out: string, width: number, height: number): Promise<{ ok: boolean; error?: string }> {
  if (items.length === 0) return { ok: false, error: 'no huazi' };
  const args: string[] = ['-y', '-i', input];
  for (const it of items) args.push('-i', it.path);
  const chains: string[] = ['[0:v]eq=saturation=1.05:contrast=1.03,vignette=PI/6[v0]'];
  let prev = '[v0]';
  items.forEach((it, i) => {
    const key = 'h' + i;
    chains.push('[' + (i + 1) + ':v]colorkey=0x00b140:0.30:0.08,scale=' + Math.round(width * 0.46) + ':-1[' + key + ']');
    const next = '[v' + (i + 1) + ']';
    chains.push(prev + '[' + key + ']overlay=x=(W-w)/2:y=H*0.14:enable=\'between(t,' + (it.start_ms / 1000).toFixed(2) + ',' + (it.end_ms / 1000).toFixed(2) + ')\'' + next);
    prev = next;
  });
  args.push('-filter_complex', chains.join(';'), '-map', prev, '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-shortest', out);
  return runFfmpeg(args);
}
`;
});
