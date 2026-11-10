import React, { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useApp, useMeta } from '../lib/store';
import { Button, Chip, Field, Panel, Pill } from '../components/ui';
import { Icon } from '../components/Icon';
import type { Project, VisualStyleId } from '../lib/types';

export function StylesPage({ projectId, project }: { projectId: number; project: Project | null }): React.ReactElement {
  const { notify } = useApp();
  const m = useMeta();
  const [current, setCurrent] = useState<VisualStyleId>(project?.visual_style ?? 'photoreal');
  const [content, setContent] = useState('演播厅，主持人面向镜头微笑，中景');
  const [preview, setPreview] = useState<{ prompt: string; negative: string } | null>(null);

  const apply = async () => {
    try {
      await api.patchProject(projectId, { visual_style: current });
      notify('项目风格已切换为 ' + current, 'success');
    } catch (err) { notify((err as ApiError).message, 'error'); }
  };

  const uploadRef = async (file: File) => {
    try {
      const asset = await api.uploadAsset(projectId, file, { type: 'image' });
      await api.setStyleRef(projectId, asset.id);
      notify('风格参考图已登记为项目锚点', 'success');
    } catch (err) { notify((err as ApiError).message, 'error'); }
  };

  const build = async () => {
    try {
      const res = await api.styles().then(async () => {
        const prompt = ((m?.styles.find((s) => s.id === current)?.prefix ?? '') + ', ' + content);
        return { prompt, negative: m?.styles.find((s) => s.id === current)?.negative ?? '' };
      });
      setPreview(res);
    } catch { /* ignore */ }
  };

  return (
    <>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div>
          <div className="hero-eyebrow">27 · 多视觉风格体系</div>
          <h1 style={{ margin: '6px 0 0', fontSize: 22, color: 'var(--text-1)', fontWeight: 600 }}>写实 / 2D / 3D / 漫画</h1>
          <div className="hint" style={{ marginTop: 4 }}>风格决定画成什么样，引擎决定在哪算——两者正交，300 秒硬约束对所有风格一视同仁。</div>
        </div>
        <div className="spacer" />
        <Button kind="primary" icon="check" onClick={apply}>应用到项目</Button>
      </div>

      <div className="grid-2">
        {(m?.styles ?? []).map((s) => (
          <div key={s.id} className="panel" style={{ cursor: 'pointer', borderColor: current === s.id ? 'rgba(212,184,126,.5)' : undefined, background: current === s.id ? 'linear-gradient(160deg, rgba(212,184,126,.1), #131821)' : undefined }} onClick={() => setCurrent(s.id)}>
            <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="row">
                <Icon name="style" size={16} />
                <b style={{ color: 'var(--text-1)', fontSize: 14 }}>{s.label}</b>
                <div className="spacer" />
                {current === s.id ? <Pill tone="gold">当前</Pill> : <Pill>{s.short}</Pill>}
              </div>
              <div className="hint">{s.description}</div>
              <div className="chips">
                {s.fit.map((f) => <span key={f} className="tag">{f}</span>)}
              </div>
              <div className="kv">
                <dt>风格前缀</dt><dd style={{ fontSize: 11.5, color: 'var(--text-2)' }}>{s.prefix.slice(0, 70)}…</dd>
                <dt>云端模型</dt><dd className="mono" style={{ fontSize: 11.5 }}>{s.muse_model}</dd>
                <dt>本地工作流</dt><dd className="mono" style={{ fontSize: 11.5 }}>{s.comfy_template_key}</dd>
                <dt>宫格/条漫</dt><dd>{s.supports_panels ? '支持' : '不支持'}</dd>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="split">
        <Panel title="风格参考图" sub="上传一张定义画风的参考图，中台分析后统一应用到全项目">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {project?.style_ref_asset_id ? (
              <img src={'/api/v1/assets/' + project.style_ref_asset_id + '/raw'} alt="风格参考" style={{ width: '100%', borderRadius: 10, border: '1px solid var(--border)' }} />
            ) : <div className="hint">尚未登记风格参考图</div>}
            <label className="btn" style={{ cursor: 'pointer', alignSelf: 'flex-start' }}>
              <Icon name="upload" size={14} /> 上传风格参考图
              <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadRef(f); }} />
            </label>
            <div className="hint">风格分析提示词：{m?.styles.find((s) => s.id === current)?.ref_analysis_prompt}</div>
          </div>
        </Panel>

        <Panel title="提示词组装预览" sub="风格前缀 + 画面内容 + 角色/场景锚定 + 镜头语言 + 负向约束">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Field label="画面内容"><input className="input" value={content} onChange={(e) => setContent(e.target.value)} /></Field>
            <Button icon="sparkle" onClick={build}>组装提示词</Button>
            {preview && (
              <>
                <div className="warn-block" style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>POSITIVE: {preview.prompt}</div>
                <div className="danger-block" style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>NEGATIVE: {preview.negative}</div>
              </>
            )}
          </div>
        </Panel>
      </div>
    </>
  );
}
