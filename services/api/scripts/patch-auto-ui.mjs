import fs from 'node:fs';
const W = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\web\\src\\";
function pf(rel, fn) { const p = W + rel; let s = fs.readFileSync(p, 'utf8'); const o = fn(s); if (o !== s) { fs.writeFileSync(p, o); console.log('patched', rel); } }
pf('pages\\Overview.tsx', (s) => {
  if (s.includes('自动成片')) return s;
  let out = s.replace("            <span className=\"hint\" style={{ width: 56 }}>语言</span>", "            <span className=\"hint\" style={{ width: 56 }}>语言</span>");
  out = out.replace("          <div className=\"hint\">出海流程：", `          <div className="row wrap" style={{ gap: 10, alignItems: 'center' }}>
            <span className="hint" style={{ width: 56 }}>成片</span>
            <Toggle on={Boolean((data.project as unknown as { auto_compose?: number }).auto_compose)} onChange={async (v) => {
              try { await api.patchProject(projectId, { auto_compose: v }); notify(v ? '已开启自动成片：渲染队列排空后自动合成' : '已关闭自动成片', 'success'); reload(); }
              catch (err) { notify(String((err as Error).message), 'error'); }
            }} />
            <span className="hint">自动成片（队列排空后自动合成并登记导出，不再需要手动点合成）</span>
          </div>
          <div className="hint">出海流程：`);
  return out;
});
