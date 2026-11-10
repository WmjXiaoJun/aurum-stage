import fs from 'node:fs';
const R = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\";
function pf(p, fn) { let s = fs.readFileSync(p, 'utf8'); const o = fn(s); if (o !== s) { fs.writeFileSync(p, o); console.log('patched', p.split('\\').pop()); } }

pf(R + 'scheduler\\scheduler.ts', (s) => {
  if (s.includes('maybeAutoCompose')) return s;
  let out = s.replace("import { executeTask } from './executors.js';", "import { executeTask } from './executors.js';\nimport { maybeAutoCompose } from './task-service.js';");
  out = out.replace("  } finally {\n    running.delete(task.id);\n  }", "  } finally {\n    running.delete(task.id);\n    // 队列排空后自动合成（项目开启 auto_compose 时）\n    if (task.task_type !== 'compose') { try { maybeAutoCompose(task.project_id); } catch (e) { logger.warn('自动合成排队失败：' + String(e), { service: 'scheduler' }); } }\n  }");
  return out;
});

pf(R + 'domain\\project-service.ts', (s) => s.includes("'auto_compose'") ? s
  : s.replace("'style_ref_asset_id', 'language'];", "'style_ref_asset_id', 'language', 'auto_compose'];")
     .replace("values.push(key === 'privacy_mode' ? (v ? 1 : 0) : key === 'global_config' ? jstr(v) : v);", "values.push(key === 'privacy_mode' || key === 'auto_compose' ? (v ? 1 : 0) : key === 'global_config' ? jstr(v) : v);"));

pf(R + 'domain\\development-pack.ts', (s) => s.includes('auto_compose') ? s
  : s.replace("  const stageDesc = str(staging.stage?.desc);", "  run('UPDATE project SET auto_compose = 1 WHERE id = ?', [projectId]);\n  const stageDesc = str(staging.stage?.desc);"));
