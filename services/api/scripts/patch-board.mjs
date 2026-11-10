import fs from 'node:fs';
const R = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\";
const W = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\web\\src\\";
function pf(p, fn) { let s = fs.readFileSync(p, 'utf8'); const o = fn(s); if (o !== s) { fs.writeFileSync(p, o); console.log('patched', p.split('\\').pop()); } }

pf(R + 'routes\\projects.ts', (s) => {
  if (s.includes("app.get('/board'")) return s;
  return s.replace("  app.get('/projects/:id/overview'", `  /** 批次看板：每个项目的渲染进度 / 自动成片 / 导出数量 */
  app.get('/board', async () => {
    const rows = all<Record<string, unknown>>('SELECT id, name, status, auto_compose, aspect_ratio, updated_at FROM project ORDER BY updated_at DESC LIMIT 40');
    return rows.map((p) => {
      const id = Number(p.id);
      const tasks = all<Record<string, unknown>>('SELECT status, task_type FROM render_task WHERE project_id = ?', [id]);
      const pending = tasks.filter((t) => ['pending', 'assigned', 'running'].includes(String(t.status))).length;
      const failed = tasks.filter((t) => String(t.status) === 'failed').length;
      const exportsCount = Number(get('SELECT COUNT(*) AS n FROM compose_export WHERE project_id = ?', [id])?.n ?? 0);
      const totalShots = Number(get('SELECT COUNT(*) AS n FROM round_shot WHERE project_id = ?', [id])?.n ?? 0);
      const generated = Number(get('SELECT COUNT(*) AS n FROM round_shot WHERE project_id = ? AND preview_asset_id IS NOT NULL', [id])?.n ?? 0);
      return { id, name: String(p.name), status: String(p.status), auto_compose: Number(p.auto_compose ?? 0), aspect_ratio: String(p.aspect_ratio ?? ''), pending, failed, exports: exportsCount, generated, total_shots: totalShots };
    });
  });

  app.get('/projects/:id/overview'`);
});

pf(W + 'lib\\api.ts', (s) => s.includes('board:') ? s : s.replace("  projectCovers: (id: number) =>", "  board: () => request<Array<Record<string, unknown>>>('/board'),\n  projectCovers: (id: number) =>"));

pf(W + 'pages\\Projects.tsx', (s) => {
  if (s.includes('批次看板')) return s;
  let out = s.replace("  const [covers, setCovers] = useState<Record<number, string>>({});", "  const [covers, setCovers] = useState<Record<number, string>>({});\n  const { data: board, reload: reloadBoard } = useAsync(() => api.board(), []);\n  useEffect(() => { const t = window.setInterval(() => reloadBoard(), 8000); return () => window.clearInterval(t); }, []);");
  out = out.replace("      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>", `      <Panel title="批次看板 · 自动成片" sub="开启自动成片的项目：渲染进度、队列、导出数量；每 8 秒刷新">
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>项目</th><th style={{ width: 150 }}>渲染进度</th><th style={{ width: 90 }}>队列</th><th style={{ width: 80 }}>失败</th><th style={{ width: 80 }}>导出</th><th style={{ width: 110 }}>成片</th></tr></thead>
            <tbody>
              {(board ?? []).filter((b) => Number(b.auto_compose) === 1).map((b) => {
                const total = Number(b.total_shots ?? 0);
                const done = Number(b.generated ?? 0);
                const pct = total ? Math.round((done / total) * 100) : 0;
                return (
                  <tr key={String(b.id)} style={{ cursor: 'pointer' }} onClick={() => navigate('/project/' + b.id + '/overview')}>
                    <td>{String(b.name)}</td>
                    <td>
                      <div style={{ height: 6, background: 'var(--bg-panel-2)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: pct + '%', height: '100%', background: 'linear-gradient(90deg, var(--gold), var(--gold-light))' }} />
                      </div>
                      <span className="hint">{done}/{total}</span>
                    </td>
                    <td>{Number(b.pending) > 0 ? <Pill tone="warn">进行中 {String(b.pending)}</Pill> : <Pill tone="up">空闲</Pill>}</td>
                    <td>{Number(b.failed) > 0 ? <Pill tone="down">{String(b.failed)}</Pill> : <span className="hint">—</span>}</td>
                    <td>{String(b.exports)}</td>
                    <td>{Number(b.exports) > 0 ? <Pill tone="up">已出片</Pill> : <span className="hint">待合成</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>`);
  return out;
});
