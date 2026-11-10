import fs from 'node:fs';
const W = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\web\\src\\";
function pf(rel, fn) { const p = W + rel; let s = fs.readFileSync(p, 'utf8'); const o = fn(s); if (o !== s) { fs.writeFileSync(p, o); console.log('patched', rel); } }
pf('lib\\api.ts', (s) => s.includes('runDevelopmentPack') ? s : s.replace(
  "  runSkill: (id: number, key: string, body: Record<string, unknown> = {}) =>",
  "  runDevelopmentPack: (id: number, body: Record<string, unknown>) => request<{ ok: boolean; stopped_at: string | null; steps: Array<{ key: string; name: string; status: string; gates: Array<{ id: string; label: string; pass: boolean; detail: string }> }>; created?: { segments: number; shots: number; characters: number } }>('/projects/' + id + '/skills/development-pack', { method: 'POST', body: JSON.stringify(body) }),\n  runSkill: (id: number, key: string, body: Record<string, unknown> = {}) =>"
));
pf('pages\\Skills.tsx', (s) => {
  if (s.includes('开发包')) return s;
  let out = s.replace(
    "  const [view, setView] = useState<{ key: string; body: unknown; gates: Array<{ id: string; label: string; pass: boolean; detail: string }>; status: string; version: number } | null>(null);",
    "  const [view, setView] = useState<{ key: string; body: unknown; gates: Array<{ id: string; label: string; pass: boolean; detail: string }>; status: string; version: number } | null>(null);\n  const [packBrief, setPackBrief] = useState('');\n  const [packBusy, setPackBusy] = useState(false);\n  const [pack, setPack] = useState<{ ok: boolean; stopped_at: string | null; steps: Array<{ name: string; status: string; gates: Array<{ pass: boolean }> }>; created?: { segments: number; shots: number; characters: number } } | null>(null);"
  );
  out = out.replace(
    "      {shown.length === 0 ? <Panel>",
    "      <Panel title=\"综艺开发包 · 一键开发\" sub=\"角色 → 大纲 → 台本 → 调度 → 分镜，逐道质量门校验；全过后自动落成段与镜头\">\n        <div className=\"row wrap\" style={{ gap: 10, alignItems: 'flex-end' }}>\n          <div style={{ flex: 1, minWidth: 320 }}>\n            <Field label=\"本期创意\"><input className=\"input\" value={packBrief} onChange={(e) => setPackBrief(e.target.value)} placeholder=\"例如：三位主持人聊 AI 会不会取代综艺导演，要有三个反转和一个泪点\" /></Field>\n          </div>\n          <Button kind=\"primary\" disabled={packBusy || packBrief.trim().length < 6} onClick={async () => {\n            setPackBusy(true); setPack(null);\n            try { const r = await api.runDevelopmentPack(projectId, { brief: packBrief }); setPack(r as never); notify(r.ok ? '开发包完成，已落 ' + (r.created?.segments ?? 0) + ' 段 / ' + (r.created?.shots ?? 0) + ' 镜' : '停在「' + r.stopped_at + '」，先修质量门', r.ok ? 'success' : 'info'); reload(); }\n            catch (e) { notify(String((e as Error).message), 'error'); }\n            finally { setPackBusy(false); }\n          }}>{packBusy ? '流水线运行中…' : '一键开发'}</Button>\n        </div>\n        {pack && (\n          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>\n            {pack.steps.map((st) => { const pass = st.gates.filter((g) => g.pass).length; return (\n              <div key={st.name} className=\"row\" style={{ gap: 8, fontSize: 12.5 }}>\n                <span style={{ color: st.status === 'passed' ? 'var(--up)' : 'var(--down)' }}>{st.status === 'passed' ? '通过' : '未过'}</span>\n                <span style={{ color: 'var(--text-1)' }}>{st.name}</span>\n                <span className=\"hint\">{pass}/{st.gates.length} 道门</span>\n              </div>\n            ); })\n            {pack.created && <div className=\"hint\">已落库：{pack.created.segments} 段 · {pack.created.shots} 镜 · {pack.created.characters} 个角色</div>}\n          </div>\n        )}\n      </Panel>\n\n      {shown.length === 0 ? <Panel>"
  );
  return out;
});
