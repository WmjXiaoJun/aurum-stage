/** 出海本地化：把镜头台词翻成目标语言，供配音/字幕使用 */
import { all, get, nowIso, run } from '../db/index.js';
import { translateLines, LANGUAGE_LABEL } from '../adapters/translate.js';

export async function localizeProject(projectId: number, language: string): Promise<{ language: string; translated: number; total: number }> {
  if (!LANGUAGE_LABEL[language]) throw new Error('不支持的语言：' + language);
  if (language === 'zh') return restoreChinese(projectId);
  const shots = all<Record<string, unknown>>('SELECT id, text_clean FROM round_shot WHERE project_id = ? ORDER BY id', [projectId]);
  const texts = shots.map((s) => String(s.text_clean ?? ''));
  const index: number[] = [];
  texts.forEach((t, i) => { if (t.trim()) index.push(i); });
  const translated = await translateLines(index.map((i) => texts[i]), language);
  index.forEach((shotIdx, k) => {
    run('UPDATE round_shot SET text_local = ?, lang = ?, updated_at = ? WHERE id = ?', [String(translated[k] ?? texts[shotIdx]), language, nowIso(), Number(shots[shotIdx].id)]);
  });
  run('UPDATE project SET language = ?, updated_at = ? WHERE id = ?', [language, nowIso(), projectId]);
  return { language, translated: index.length, total: shots.length };
}

export function restoreChinese(projectId: number): { language: string; translated: number; total: number } {
  run("UPDATE round_shot SET text_local = NULL, lang = NULL WHERE project_id = ?", [projectId]);
  run("UPDATE project SET language = 'zh', updated_at = ? WHERE id = ?", [nowIso(), projectId]);
  const row = get('SELECT COUNT(*) AS n FROM round_shot WHERE project_id = ?', [projectId]);
  return { language: 'zh', translated: 0, total: Number(row?.n ?? 0) };
}
