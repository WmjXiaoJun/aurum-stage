import React, { useState } from 'react';
import { api } from '../lib/api';
import { useApp, useAsync } from '../lib/store';
import { Button, Chip, Field, Modal, Panel, Pill, Skeleton, ErrorState, EmptyState } from '../components/ui';

interface SkillCard { key: string; name: string; group: string; summary: string; outputs: string[]; version: number; status: string; gates: Array<{ id: string; label: string; pass: boolean; detail: string }>; updated_at: string | null }

const GROUPS = ['全部', '开发', '写作', '视觉', '分镜'];

export function SkillsPage({ projectId }: { projectId: number }): React.ReactElement {
  const { notify } = useApp();
  const { data, loading, error, reload } = useAsync(() => api.projectSkills(projectId), [projectId]);
  const [group, setGroup] = useState('全部');
  const [running, setRunning] = useState<string | null>(null);
  const [brief, setBrief] = useState('');
  const [runOpen, setRunOpen] = useState<SkillCard | null>(null);
  const [view, setView] = useState<{ key: string; body: unknown; gates: Array<{ id: string; label: string; pass: boolean; detail: string }>; status: string; version: number } | null>(null);
  const [packBrief, setPackBrief] = useState('');
  const [packBusy, setPackBusy] = useState(false);
  const [pack, setPack] = useState<{ ok: boolean; stopped_at: string | null; steps: Array<{ name: string; status: string; gates: Array<{ pass: boolean }> }>; created?: { segments: number; shots: number; characters: number } } | null>(null);

  const list = (data ?? []) as unknown as SkillCard[];
  const shown = group === '全部' ? list : list.filter((s) => s.group === group);

  const openView = async (key: string) => {
    try {
      const doc = await api.skillDoc(projectId, key);
      if (!doc.body) { notify('这个技能还没有产物，先运行一次', 'info'); return; }
      setView({ key, body: doc.body, gates: (doc.gates ?? []) as never, status: String(doc.status ?? ''), version: Number(doc.version ?? 0) });
    } catch (e) { notify(String((e as Error).message), 'error'); }
  };

  const run = async () => {
    if (!runOpen) return;
    setRunning(runOpen.key);
    try {
      const res = await api.runSkill(projectId, runOpen.key, { brief });
      const passed = res.gates.filter((g) => g.pass).length;
      notify('技能完成：' + passed + '/' + res.gates.length + ' 道门通过', res.status === 'passed' ? 'success' : 'info');
      setRunOpen(null);
      setBrief('');
      reload();
      setView({ key: runOpen.key, body: res.body, gates: res.gates as never, status: res.status, version: res.version });
    } catch (e) { notify(String((e as Error).message), 'error'); }
    finally { setRunning(null); }
  };

  const applyScript = async () => {
    if (!view) return;
    try {
      const r = await api.applySkill(projectId, view.key);
      notify('已落回台本：更新 ' + String((r as { updated_shots?: number }).updated_shots ?? 0) + ' 镜', 'success');
    } catch (e) { notify(String((e as Error).message), 'error'); }
  };

  if (loading && !data) return <div className="panel"><Skeleton rows={4} height={90} /></div>;
  if (error) return <div className="panel"><ErrorState message={error} onRetry={reload} /></div>;

  return (
    <>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div>
          <div className="hero-eyebrow">创作 · 技能库（参照 shuohao-skills）</div>
          <h1 style={{ margin: '6px 0 0', fontSize: 24, color: 'var(--text-1)', fontWeight: 700 }}>剧本工坊</h1>
          <div className="hint" style={{ marginTop: 4 }}>七个技能覆盖从人物、大纲、台本到舞台调度与分镜；产物结构化落库，质量门由代码确定性校验，不靠模型自觉。</div>
        </div>
        <div className="spacer" />
        <div className="chips">
          {GROUPS.map((g) => <Chip key={g} on={group === g} onClick={() => setGroup(g)}>{g}</Chip>)}
        </div>
      </div>

      <Panel title="综艺开发包 · 一键开发" sub="角色 → 大纲 → 台本 → 调度 → 分镜，逐道质量门校验；全过后自动落成段与镜头">
        <div className="row wrap" style={{ gap: 10, alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 320 }}>
            <Field label="本期创意"><input className="input" value={packBrief} onChange={(e) => setPackBrief(e.target.value)} placeholder="例如：三位主持人聊 AI 会不会取代综艺导演，要有三个反转和一个泪点" /></Field>
          </div>
          <Button kind="primary" disabled={packBusy || packBrief.trim().length < 6} onClick={async () => {
            setPackBusy(true); setPack(null);
            try { const r = await api.runDevelopmentPack(projectId, { brief: packBrief }); setPack(r as never); notify(r.ok ? '开发包完成，已落 ' + (r.created?.segments ?? 0) + ' 段 / ' + (r.created?.shots ?? 0) + ' 镜' : '停在「' + r.stopped_at + '」，先修质量门', r.ok ? 'success' : 'info'); reload(); }
            catch (e) { notify(String((e as Error).message), 'error'); }
            finally { setPackBusy(false); }
          }}>{packBusy ? '流水线运行中…' : '一键开发'}</Button>
        </div>
        {pack && (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {pack.steps.map((st) => { const pass = st.gates.filter((g) => g.pass).length; return (
              <div key={st.name} className="row" style={{ gap: 8, fontSize: 12.5 }}>
                <span style={{ color: st.status === 'passed' ? 'var(--up)' : 'var(--down)' }}>{st.status === 'passed' ? '通过' : '未过'}</span>
                <span style={{ color: 'var(--text-1)' }}>{st.name}</span>
                <span className="hint">{pass}/{st.gates.length} 道门</span>
              </div>
            ); })}
            {pack.created && <div className="hint">已落库：{pack.created.segments} 段 · {pack.created.shots} 镜 · {pack.created.characters} 个角色</div>}
          </div>
        )}
      </Panel>

      {shown.length === 0 ? <Panel><EmptyState title="没有技能" desc="检查服务是否启动" /></Panel> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: 16 }}>
          {shown.map((s) => {
            const pass = s.gates.filter((g) => g.pass).length;
            return (
              <Panel key={s.key} title={s.name} sub={s.group + ' · ' + (s.version ? 'v' + s.version : '未运行')}
                right={<Pill tone={s.status === 'passed' ? 'up' : s.status === 'needs_revision' ? 'warn' : null}>{s.status === 'passed' ? '通过' : s.status === 'needs_revision' ? '待修' : '未运行'}</Pill>}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div className="hint" style={{ minHeight: 44 }}>{s.summary}</div>
                  <div className="chips">{s.outputs.map((o) => <span key={o} className="tag">{o}</span>)}</div>
                  <div className="hint">质量门 {s.gates.length ? pass + '/' + s.gates.length + ' 通过' : '—'}</div>
                  <div className="row" style={{ gap: 8 }}>
                    <Button size="small" kind="primary" onClick={() => { setRunOpen(s); setBrief(''); }}>运行</Button>
                    <Button size="small" onClick={() => openView(s.key)} disabled={!s.version}>查看产物</Button>
                  </div>
                </div>
              </Panel>
            );
          })}
        </div>
      )}

      <Modal open={runOpen != null} title={'运行技能 · ' + (runOpen?.name ?? '')} onClose={() => setRunOpen(null)}
        footer={<><Button kind="ghost" onClick={() => setRunOpen(null)} disabled={!!running}>取消</Button><Button kind="primary" onClick={run} disabled={!!running}>{running ? '生成中…' : '开始生成'}</Button></>}>
        <Field label="补充创意（可选，留空则用项目台本）">
          <textarea className="textarea" rows={4} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="例如：本期聊“AI 会不会取代综艺导演”，要有三个反转和一个泪点" />
        </Field>
        <div className="hint">产物会存成新版本；质量门不通过时仍会保存，方便逐条修。</div>
      </Modal>

      <Modal open={view != null} wide title={'技能产物 · ' + (view?.key ?? '')} onClose={() => setView(null)}
        footer={<>{view?.key === 'variety-script' && <Button kind="primary" onClick={applyScript}>落回台本（覆盖镜头台词）</Button>}<Button kind="ghost" onClick={() => setView(null)}>关闭</Button></>}>
        {view && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="row" style={{ gap: 8 }}>
              <Pill tone={view.status === 'passed' ? 'up' : 'warn'}>{view.status}</Pill>
              <Pill>v{view.version}</Pill>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {view.gates.map((g) => (
                <div key={g.id} className="row" style={{ gap: 8, fontSize: 12.5 }}>
                  <span style={{ color: g.pass ? 'var(--up)' : 'var(--down)' }}>{g.pass ? '通过' : '未过'}</span>
                  <span style={{ color: 'var(--text-1)' }}>{g.label}</span>
                  <span className="hint">{g.detail}</span>
                </div>
              ))}
            </div>
            <pre className="mono" style={{ margin: 0, maxHeight: 460, overflow: 'auto', fontSize: 11.5, color: 'var(--text-2)' }}>{JSON.stringify(view.body, null, 2)}</pre>
          </div>
        )}
      </Modal>
    </>
  );
}
