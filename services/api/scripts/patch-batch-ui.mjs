import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\web\\src\\pages\\Engineering.tsx";
let s = fs.readFileSync(p, 'utf8');
if (!s.includes('batchClone')) {
  s = s.replace("  const [busy, setBusy] = useState(false);", "  const [busy, setBusy] = useState(false);\n  const [grid, setGrid] = useState<Array<{ language: string; visual_style: string }>>([{ language: 'en', visual_style: '2d' }, { language: 'ja', visual_style: '3d' }]);\n  const [created, setCreated] = useState<number[]>([]);");
  s = s.replace("  const abstract = async () => {", "  const batchClone = async () => {\n    setBusy(true);\n    try { const r = await api.batchCloneEngineering(projectId, { grid }); setCreated(r.created); notify('批量复刻完成：' + r.count + ' 个项目', 'success'); }\n    catch (e) { notify(String((e as Error).message), 'error'); }\n    finally { setBusy(false); }\n  };\n\n  const abstract = async () => {");
  s = s.replace("      <div className=\"chips\" style={{ marginBottom: 8 }}>", `      <Panel title="批量复刻 · 槽位矩阵" sub="一次生成多个变体，每个变体独立落项目、独立过 300 秒校验">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {grid.map((row, i) => (
            <div key={i} className="row wrap" style={{ gap: 10, alignItems: 'flex-end' }}>
              <Field label={'变体 ' + (i + 1) + ' 语言'}>
                <select className="select" value={row.language} onChange={(e) => setGrid(grid.map((g, gi) => gi === i ? { ...g, language: e.target.value } : g))}>
                  {LANG.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field label="画面风格">
                <select className="select" value={row.visual_style} onChange={(e) => setGrid(grid.map((g, gi) => gi === i ? { ...g, visual_style: e.target.value } : g))}>
                  {STYLE.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Button size="small" onClick={() => setGrid(grid.filter((_, gi) => gi !== i))}>删除</Button>
            </div>
          ))}
          <div className="row" style={{ gap: 8 }}>
            <Button size="small" onClick={() => setGrid([...grid, { language: 'en', visual_style: 'realistic' }])}>+ 加一行</Button>
            <Button kind="primary" onClick={batchClone} disabled={busy}>{busy ? '处理中…' : '批量复刻'}</Button>
          </div>
          {created.length > 0 && (
            <div className="row wrap" style={{ gap: 8 }}>
              <span className="hint">已创建：</span>
              {created.map((id) => <a key={id} className="btn small" href={'/project/' + id + '/overview'}>项目 {id}</a>)}
            </div>
          )}
        </div>
      </Panel>

      <div className="chips" style={{ marginBottom: 8 }}>`);
  fs.writeFileSync(p, s);
  console.log('batch ui patched');
} else console.log('already');
