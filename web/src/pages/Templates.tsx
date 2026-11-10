import React, { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useApp, useAsync } from '../lib/store';
import { Button, Chip, EmptyState, ErrorState, Modal, Panel, Pill, Skeleton, Toggle } from '../components/ui';
import { Icon } from '../components/Icon';
import type { Template } from '../lib/types';
import { TEMPLATE_TYPE_LABEL, templateLabel, styleName, describeConstraints } from '../lib/zh';
import { navigate } from '../lib/router';

const TYPES = [
  { id: 'all', label: '全部' },
  { id: 'comfy_workflow', label: '本地工作流' },
  { id: 'muse_api', label: '云端参数' },
  { id: 'tts_preset', label: '配音预设' },
  { id: 'variety_show', label: '综艺形态' },
  { id: 'engineering_template', label: '工程模板' }
];

export function TemplatesPage(): React.ReactElement {
  const { notify } = useApp();
  const [type, setType] = useState('all');
  const { data: rawData, loading, error, reload } = useAsync(() => api.templates(type === 'all' ? undefined : type), [type]);
  const data = [...(rawData ?? [])].sort((a, b) => (a.template_type === 'variety_show' ? -1 : 0) - (b.template_type === 'variety_show' ? -1 : 0));
  const [view, setView] = useState<Template | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);

  if (loading && !data) return <div className="panel"><Skeleton rows={4} height={70} /></div>;
  if (error) return <div className="panel"><ErrorState message={error} onRetry={reload} /></div>;

  return (
    <>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div>
          <div className="hero-eyebrow">M6 · 三类模板</div>
          <h1 style={{ margin: '6px 0 0', fontSize: 22, color: 'var(--text-1)', fontWeight: 600 }}>模板库</h1>
          <div className="hint" style={{ marginTop: 4 }}>workflow / params / presets 都是「配置即代码」：入 Git、可评审、可回滚。</div>
        </div>
        <div className="spacer" />
        <div className="chips">
          {TYPES.map((t) => <Chip key={t.id} on={type === t.id} onClick={() => setType(t.id)}>{t.label}</Chip>)}
        </div>
        <Button icon="refresh" onClick={reload}>刷新</Button>
      </div>

      {(data ?? []).length === 0 ? (
        <Panel><EmptyState title="没有模板" desc="种子数据会预置四类风格的工作流与 TTS 预设。" /></Panel>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {data.map((t) => (
            <Panel key={t.id} noBody>
              <div style={{ padding: '12px 18px', display: 'flex', gap: 12, alignItems: 'center' }}>
                <div style={{ position: 'relative', width: 160, height: 90, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', background: '#06080b', display: 'grid', placeItems: 'center' }}>
                  <Icon name="template" size={18} />
                  <img
                    src={'/api/v1/templates/' + t.template_key + '/cover'}
                    alt={t.display_name}
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <b style={{ color: 'var(--text-1)', fontSize: 13 }}>{templateLabel(t.template_key, t.display_name)}</b>
                    <Pill tone={t.template_type === 'comfy_workflow' ? 'jade' : t.template_type === 'muse_api' ? 'gold' : null}>{TEMPLATE_TYPE_LABEL[t.template_type] ?? '模板'}</Pill>
                    {t.visual_style && <span className="tag">{styleName(t.visual_style)}</span>}
                  </div>
                  <div className="hint">编号 {t.id} · 参数项 {Object.keys(t.param_map ?? {}).length} 个</div>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <Toggle on={t.enabled} onChange={async (v) => { try { await api.patchTemplate(t.template_key, { enabled: v }); notify('已更新模板状态', 'success'); reload(); } catch (err) { notify((err as ApiError).message, 'error'); } }} />
                  <Button size="small" onClick={() => setView(t)}>查看结构</Button>
                  {t.template_type === 'variety_show' && <Button size="small" icon="play" onClick={() => setPreviewKey(t.template_key)}>预览片</Button>}
                  {t.template_type === 'engineering_template' && (
                    <Button size="small" kind="primary" onClick={async () => {
                      try { const r = await api.instantiateTemplate(t.template_key, { name: t.display_name + ' · 实例' }); notify('已实例化工程模板', 'success'); navigate('/project/' + r.project_id + '/overview'); }
                      catch (err) { notify(String((err as Error).message), 'error'); }
                    }}>实例化</Button>
                  )}
                  {t.template_type === 'variety_show' && (
                    <>
                      {[{ id: 'photoreal', label: '真实' }, { id: 'anime_2d', label: '2D' }, { id: 'cgi_3d', label: '3D' }].map((st) => (
                        <Button
                          key={st.id}
                          size="small"
                          kind="primary"
                          onClick={async () => {
                            try {
                              const r = await api.applyTemplate(t.template_key, { visual_style: st.id, name: t.display_name + ' · ' + st.label });
                              notify('已用模板建项目（' + st.label + '）', 'success');
                              navigate('/project/' + r.project_id + '/overview');
                            } catch (err) { notify(String((err as Error).message), 'error'); }
                          }}
                        >{st.label}</Button>
                      ))}
                    </>
                  )}
                </div>
              </div>
            </Panel>
          ))}
        </div>
      )}

      <Modal open={previewKey != null} wide title={'模板验证片'} onClose={() => setPreviewKey(null)} footer={<Button kind="ghost" onClick={() => setPreviewKey(null)}>关闭</Button>}>
        {previewKey && <video key={previewKey} src={'/api/v1/templates/' + previewKey + '/preview'} controls playsInline style={{ width: '100%', maxHeight: 520, background: '#000', borderRadius: 10 }} />}
      </Modal>

      <Modal open={view != null} wide title={'模板 · ' + (view?.display_name ?? '')} onClose={() => setView(null)}>
        {view && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="kv">
              <dt>模板类型</dt><dd>{TEMPLATE_TYPE_LABEL[view.template_type] ?? '模板'}</dd>
              <dt>节点数量</dt><dd>{Object.keys(view.template_body ?? {}).filter((k) => !k.startsWith('_')).length} 个</dd>
              <dt>可注入参数</dt><dd>{Object.keys(view.param_map ?? {}).length} 项（台词 / 反向描述 / 种子 / 画面尺寸 / 参考图等）</dd>
              <dt>运行约束</dt><dd>{describeConstraints(view.constraints)}</dd>
            </div>
            <div className="hint">该模板由「本地渲染服务探测」自动生成，镜头渲染时中台会把参数注入到对应节点。</div>
          </div>
        )}
      </Modal>
    </>
  );
}
