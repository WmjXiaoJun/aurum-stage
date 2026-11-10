import React, { useState } from 'react';
import { api } from '../lib/api';
import { useApp, useAsync, useMeta } from '../lib/store';
import { Button, Chip, EmptyState, ErrorState, Panel, Pill, Skeleton } from '../components/ui';
import { Icon } from '../components/Icon';
import { navigate } from '../lib/router';
import { relative } from '../lib/format';
import { errorLabel, retryLabel } from '../lib/zh';

export function QaPage({ projectId }: { projectId: number }): React.ReactElement {
  const { notify } = useApp();
  const m = useMeta();
  const [showAll, setShowAll] = useState(false);
  const { data, loading, error, reload } = useAsync(() => api.issues(projectId, showAll ? 'all' : 'open'), [projectId, showAll]);

  if (loading && !data) return <div className="panel"><Skeleton rows={5} height={56} /></div>;
  if (error) return <div className="panel"><ErrorState message={error} onRetry={reload} /></div>;

  const issues = data ?? [];
  const errors = issues.filter((i) => i.level === 'error');

  return (
    <>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div>
          <div className="hero-eyebrow">质检中心 · 质检 Agent 产出</div>
          <h1 style={{ margin: '6px 0 0', fontSize: 22, color: 'var(--text-1)', fontWeight: 600 }}>问题清单</h1>
        </div>
        <div className="spacer" />
        <div className="chips">
          <Chip on={!showAll} onClick={() => setShowAll(false)}>未解决 {issues.filter((i) => !i.resolved).length}</Chip>
          <Chip on={showAll} onClick={() => setShowAll(true)}>全部</Chip>
        </div>
        <Button icon="refresh" onClick={reload}>刷新</Button>
      </div>

      <div className="row" style={{ gap: 10 }}>
        <Pill tone={errors.length ? 'down' : 'up'} dot>{errors.length} 个阻断项</Pill>
        <Pill tone="warn">{issues.length - errors.length} 个警告</Pill>
        <span className="hint">阻断项不通过不进入渲染（26.5）</span>
      </div>

      {issues.length === 0 ? (
        <Panel><EmptyState title="没有待处理的问题" desc="跑一次智能体流水线或修改台本后，质检结果会出现在这里。" action={<Button kind="primary" icon="agent" onClick={() => navigate('/project/' + projectId + '/agent')}>去跑智能体</Button>} /></Panel>
      ) : (
        <Panel noBody title="问题列表" sub="点击「定位修复」跳转到对应工作区">
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {issues.map((i) => (
              <div key={i.id} style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 12, alignItems: 'center' }}>
                <div className="state-icon" style={{ width: 30, height: 30, borderRadius: 8, color: i.level === 'error' ? 'var(--down)' : 'var(--warn)', borderColor: i.level === 'error' ? 'rgba(225,91,80,.4)' : 'rgba(217,158,62,.4)' }}>
                  <Icon name={i.level === 'error' ? 'warn' : 'sparkle'} size={14} />
                </div>
                <div style={{ flex: 1 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <span style={{ fontSize: 11.5, color: 'var(--gold-light)' }}>{errorLabel(i.code)}</span>
                    <Pill tone={i.level === 'error' ? 'down' : 'warn'}>{i.level === 'error' ? '阻断' : '警告'}</Pill>
                    <span className="hint">{relative(i.created_at)}</span>
                  </div>
                  <div style={{ color: 'var(--text-1)', fontSize: 12.5, marginTop: 2 }}>{i.message}</div>
                  {i.suggestion && <div className="hint">建议：{i.suggestion}</div>}
                </div>
                <Button size="small" onClick={async () => { await api.patchIssue(i.id, { resolved: true }); notify('已标记解决', 'success'); reload(); }} disabled={Boolean(i.resolved)}>标记解决</Button>
                <Button size="small" kind="ghost" onClick={() => navigate('/project/' + projectId + '/overview')}>定位修复</Button>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel title="故障与提示字典" sub="出现问题时界面展示的中文说明与处理建议">
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th style={{ width: 200 }}>提示</th><th>含义</th><th style={{ width: 120 }}>处理方式</th><th>界面建议</th></tr></thead>
            <tbody>
              {(m?.error_codes ?? []).map((e) => (
                <tr key={e.code}>
                  <td><span style={{ color: 'var(--gold-light)' }}>{errorLabel(e.code)}</span></td>
                  <td>{e.name}</td>
                  <td><span className="hint">{retryLabel(e.retry)}</span></td>
                  <td className="hint">{e.uiHint}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
