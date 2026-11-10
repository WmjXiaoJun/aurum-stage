import fs from 'node:fs';
const R = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\";
function pf(p, fn) { let s = fs.readFileSync(p, 'utf8'); const o = fn(s); if (o !== s) { fs.writeFileSync(p, o); console.log('patched', p.split('\\').pop()); } }
pf(R + 'db\\index.ts', (s) => s.includes('auto_compose') ? s : s.replace(
  "  { table: 'round_shot', column: 'lang', ddl: \"ALTER TABLE round_shot ADD COLUMN lang TEXT\" }",
  "  { table: 'round_shot', column: 'lang', ddl: \"ALTER TABLE round_shot ADD COLUMN lang TEXT\" },\n  { table: 'project', column: 'auto_compose', ddl: 'ALTER TABLE project ADD COLUMN auto_compose INTEGER NOT NULL DEFAULT 0' }"
));
pf(R + 'scheduler\\task-service.ts', (s) => {
  if (s.includes('maybeAutoCompose')) return s;
  return s.replace("export function getTask(id: number): RenderTask {", `/** 队列排空后自动合成：项目开启 auto_compose 时，任务全部结束即排队一次合成 */
export function maybeAutoCompose(projectId: number): number | null {
  const project = get('SELECT * FROM project WHERE id = ?', [projectId]);
  if (!project || Number(project.auto_compose) !== 1) return null;
  const pending = get("SELECT COUNT(*) AS n FROM render_task WHERE project_id = ? AND status IN ('pending','assigned','running')", [projectId]);
  if (Number(pending?.n ?? 0) > 0) return null;
  const generated = get('SELECT COUNT(*) AS n FROM round_shot WHERE project_id = ? AND preview_asset_id IS NOT NULL', [projectId]);
  if (Number(generated?.n ?? 0) === 0) return null;
  const recent = get('SELECT created_at FROM compose_export WHERE project_id = ? ORDER BY id DESC LIMIT 1', [projectId]);
  if (recent && Date.now() - new Date(String(recent.created_at)).getTime() < 120000) return null;
  const res = createTask({
    project_id: projectId,
    shot_id: null,
    task_type: 'compose',
    engine: 'ffmpeg',
    engine_params: { bgm: true },
    idempotency_key: 'auto-compose-' + projectId + '-' + Math.floor(Date.now() / 60000),
    priority: 6,
    max_attempt: 1,
    meta: { bgm: true, auto: true }
  });
  emit({ type: 'compose.progress', project_id: projectId, payload: { task_id: res.task.id, progress: 0, auto: true, status: 'queued' } });
  return res.task.id;
}

export function getTask(id: number): RenderTask {`);
});
