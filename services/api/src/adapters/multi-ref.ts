/** 多人同框参考：把 2–3 个角色参考图拼成一张 1280×720 首帧 */
import fs from 'node:fs';
import path from 'node:path';
import { runFfmpeg } from '../media/ffmpeg.js';

export async function composeMultiReference(paths: string[], outPath: string, width = 1280, height = 720): Promise<boolean> {
  const valid = paths.filter((p) => p && fs.existsSync(p)).slice(0, 3);
  if (valid.length < 2) return false;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const args: string[] = ['-y'];
  for (const p of valid) args.push('-i', p);
  const n = valid.length;
  const sliceW = Math.round(width / n);
  const filters: string[] = [];
  for (let i = 0; i < n; i++) filters.push('[' + i + ':v]scale=' + sliceW + ':' + height + ':force_original_aspect_ratio=increase,crop=' + sliceW + ':' + height + '[v' + i + ']');
  const stack = valid.map((_, i) => '[v' + i + ']').join('') + 'hstack=inputs=' + n;
  filters.push(stack);
  args.push('-filter_complex', filters.join(';'), '-frames:v', '1', '-q:v', '3', outPath);
  const res = await runFfmpeg(args);
  return res.ok && fs.existsSync(outPath);
}
