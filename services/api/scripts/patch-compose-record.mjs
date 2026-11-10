import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\routes\\projects.ts";
let s = fs.readFileSync(p, 'utf8');
if (!s.includes('recordExport({ project_id: projectId')) {
  s = s.replace("import { composeProject, listExports } from '../adapters/compose.js';", "import { composeProject, listExports, recordExport } from '../adapters/compose.js';");
  s = s.replace("    try { saveEngineering(projectId, 'renderable'); } catch { /* 工程归档失败不影响出片 */ }", `    try { saveEngineering(projectId, 'renderable'); } catch { /* 工程归档失败不影响出片 */ }
    // 手动合成也写一条导出记录，和自动成片保持同一份历史
    try {
      recordExport({
        project_id: projectId,
        segment_id: body.segment_id ?? null,
        task_id: null,
        status: result.mode,
        duration_ms: result.total_ms,
        video_asset_id: result.video_asset_id ?? null,
        subtitle_asset_id: result.subtitle_asset_id ?? null,
        ass_asset_id: result.ass_asset_id ?? null,
        manifest: result.manifest as Record<string, unknown>,
        error_code: null,
        error_msg: result.warnings.join('；') || null
      });
    } catch { /* ignore */ }`);
  fs.writeFileSync(p, s);
  console.log('compose records export');
} else console.log('already');
