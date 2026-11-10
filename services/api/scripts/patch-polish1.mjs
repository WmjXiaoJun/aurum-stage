import fs from 'node:fs';
const R = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\";
function pf(p, fn) { let s = fs.readFileSync(p, 'utf8'); const o = fn(s); if (o !== s) { fs.writeFileSync(p, o); console.log('patched', p.split('\\').pop()); } }

// 1) 成片按「项目名-vN」归档到 exports 目录
pf(R + 'adapters\\compose.ts', (s) => {
  if (s.includes('deliverable')) return s;
  let out = s.replace("  const finalAbs = objectPath('assets', baseKey + '/final.mp4');", "  const finalAbs = objectPath('assets', baseKey + '/final.mp4');");
  out = out.replace("  const outAbs = burn.ok && fs.existsSync(finalAbs) ? finalAbs : mixedPath;", `  const outAbs = burn.ok && fs.existsSync(finalAbs) ? finalAbs : mixedPath;

  // 成片归档：按「项目名-vN」命名一份到 exports 目录，方便直接取片
  let deliverable: string | null = null;
  try {
    const projectRow = get('SELECT name FROM project WHERE id = ?', [input.project_id]);
    const prev = get('SELECT COUNT(*) AS n FROM compose_export WHERE project_id = ?', [input.project_id]);
    const version = Number(prev?.n ?? 0) + 1;
    const slug = String(projectRow?.name ?? ('project-' + input.project_id)).replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40);
    fs.mkdirSync(config.exportDir, { recursive: true });
    deliverable = path.join(config.exportDir, slug + '-v' + version + '.mp4');
    fs.copyFileSync(outAbs, deliverable);
  } catch { deliverable = null; }`);
  out = out.replace("    meta: { kind: 'final', cues: plan.cues.length, subtitles: true, bgm: input.bgm !== false, shots: plan.shots.length }", "    meta: { kind: 'final', cues: plan.cues.length, subtitles: true, bgm: input.bgm !== false, shots: plan.shots.length, deliverable }");
  return out;
});

// 3) 复刻/实例化项目默认开启自动成片
pf(R + 'domain\\engineering-service.ts', (s) => s.includes('auto_compose = 1') ? s : s.replace(
  "  const projectId = res.lastInsertRowid;",
  "  const projectId = res.lastInsertRowid;\n  run('UPDATE project SET auto_compose = 1 WHERE id = ?', [projectId]);"
));
pf(R + 'routes\\templates.ts', (s) => s.includes('auto_compose = 1') ? s : s.replace(
  "    run('UPDATE project SET language = ? WHERE id = ?', [language, project.id]);",
  "    run('UPDATE project SET language = ?, auto_compose = 1 WHERE id = ?', [language, project.id]);"
));
