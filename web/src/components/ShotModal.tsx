import React, { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useApp, useEvents, useMeta } from '../lib/store';
import { Button, Chip, EngineTag, Field, Modal, Pill, StatusPill, TaskPill, Toggle } from './ui';
import { Icon } from './Icon';
import { seconds, shortText, timecode } from '../lib/format';
import { taskTypeLabel, errorLabel, shotLabel } from '../lib/zh';
import type { Compliance, Shot, Task } from '../lib/types';

export function ShotModal({ shotId, open, onClose, onChanged, compliance }: {
  shotId: number | null;
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
  compliance?: Compliance | null;
}): React.ReactElement | null {
  const { notify, meta } = useApp();
  const m = useMeta();
  const [shot, setShot] = useState<Shot | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !shotId) return;
    let alive = true;
    Promise.all([api.shot(shotId), api.shotAudio(shotId)])
      .then(([detail, audio]) => {
        if (!alive) return;
        setShot(detail.shot);
        setTasks(detail.tasks);
        setDraft({
          lines: (detail.shot.lines ?? []).join('\n'),
          emotion: detail.shot.emotion ?? '',
          camera: detail.shot.camera,
          render_engine: detail.shot.render_engine,
          lipsync_required: detail.shot.lipsync_required,
          tts_speed: detail.shot.tts_speed,
          visual_prompt: detail.shot.visual_prompt ?? '',
          negative_prompt: detail.shot.negative_prompt ?? '',
          emotion_instruction: detail.shot.emotion_instruction ?? ''
        });
        void audio;
      })
      .catch((err) => notify('加载镜头失败：' + (err as Error).message, 'error'));
    return () => { alive = false; };
  }, [shotId, open, notify]);

  useEvents(shot?.project_id ?? null, (event) => {
    if (!shot) return;
    if ((event.payload as { shot_id?: number }).shot_id !== shot.id) return;
    if (['task.success', 'task.failed', 'task.preview'].includes(event.type)) {
      api.shot(shot.id).then((detail) => { setShot(detail.shot); setTasks(detail.tasks); }).catch(() => undefined);
    }
  });

  const emotions = m?.emotions ?? [];
  const cameras = m?.constants.cameras ?? [];
  const segmentCap = compliance?.cap_sec ?? 300;
  const segmentUsed = compliance?.duration_sec ?? 0;
  const overCap = Boolean(compliance?.exceed);
  const nearCap = Boolean(compliance?.near_cap);
  const durationMs = Number(shot?.tts_duration_ms ?? shot?.duration_ms ?? 0);
  const durationWarn = durationMs > 0 && (durationMs < 2000 || durationMs > 8000);

  const audioCandidates = useMemo(() => (shot?.candidates ?? []).filter((c) => c.kind === 'tts'), [shot]);
  const videoCandidates = useMemo(() => (shot?.candidates ?? []).filter((c) => c.kind === 'video'), [shot]);

  if (!open) return null;

  const patch = async (body: Record<string, unknown>, note?: string) => {
    if (!shot) return;
    setSaving(true);
    try {
      const updated = await api.patchShot(shot.id, body);
      setShot(updated);
      notify(note ?? '已保存', 'success');
      onChanged();
    } catch (err) {
      const e = err as ApiError;
      notify(e.code + ' · ' + e.message + (e.uiHint ? '（' + e.uiHint + '）' : ''), 'error');
    } finally {
      setSaving(false);
    }
  };

  const render = async () => {
    if (!shot) return;
    setBusy('render');
    try {
      const res = await api.renderShot(shot.id, { candidates: 3, overrides: { candidate_seed: Date.now() } });
      notify('已建任务链：' + res.task_dag.map((t) => t.type).join(' → '), 'success');
      onChanged();
    } catch (err) {
      const e = err as ApiError;
      const details = e.details as { exceed_sec?: number; split_hint?: string } | null;
      notify(e.code === 'SEGMENT_DURATION_EXCEED'
        ? '本段已达 ' + (details?.exceed_sec ? segmentUsed + 's' : '') + '，超出上限 ' + (details?.exceed_sec ?? '') + 's。' + (details?.split_hint ?? '请删减镜头或拆分段落')
        : e.code + ' · ' + e.message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const regenTts = async () => {
    if (!shot) return;
    setBusy('tts');
    try {
      await api.ttsShot(shot.id, { overrides: { emotion: draft.emotion, emotion_instruction: draft.emotion_instruction, speed: draft.tts_speed }, candidates: 3 });
      notify('配音任务已提交（不渲染画面）', 'success');
      onChanged();
    } catch (err) {
      notify((err as ApiError).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const selectCandidate = async (candidateId: number) => {
    if (!shot) return;
    try {
      const updated = await api.selectCandidate(shot.id, candidateId);
      setShot(updated);
      notify('已切换候选', 'success');
      onChanged();
    } catch (err) {
      notify((err as ApiError).message, 'error');
    }
  };

  return (
    <Modal
      open={open}
      wide
      title={
        <div className="row" style={{ gap: 10 }}>
          <span style={{ color: 'var(--gold-light)' }}>{shot ? shotLabel(shot.segment_seq, shot.seq) : '…'}</span>
          <span className="muted" style={{ fontSize: 12 }}>{shot?.segment_title}</span>
          {shot && <StatusPill status={shot.status} />}
        </div>
      }
      onClose={onClose}
      footer={
        <>
          <Button kind="ghost" icon="trash" onClick={async () => {
            if (!shot) return;
            if (!window.confirm('删除该镜头？此操作不可撤销')) return;
            await api.deleteShot(shot.id);
            notify('已删除镜头', 'success');
            onChanged();
            onClose();
          }}>删除</Button>
          <div className="spacer" />
          <Button icon={shot?.locked ? 'lock' : 'check'} onClick={() => patch({ locked: !shot?.locked, status: shot?.locked ? 'generated' : 'locked' }, shot?.locked ? '已解锁' : '已锁定，批量重跑将跳过')}>
            {shot?.locked ? '解锁' : '锁定'}
          </Button>
          <Button icon="mic" onClick={regenTts} disabled={busy === 'tts' || saving}>重配配音</Button>
          <Button kind="primary" icon="play" onClick={render} disabled={busy === 'render' || saving || overCap} title={overCap ? '本段已超 300 秒，需先删减或拆分' : undefined}>
            {busy === 'render' ? '提交中…' : '提交渲染'}
          </Button>
        </>
      }
    >
      {!shot ? <div className="hint">加载中…</div> : (
        <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 20 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)', background: '#0d1116', minHeight: 220 }}>
              {shot.preview_asset_id ? (
                <video src={'/api/v1/assets/' + shot.preview_asset_id + '/raw'} controls style={{ width: '100%', display: 'block' }} />
              ) : (
                <div className="state-wrap" style={{ padding: 40 }}>
                  <div className="state-icon"><Icon name="film" size={22} /></div>
                  <div className="state-title" style={{ fontSize: 12 }}>还没有可播放产物</div>
                  <div className="state-desc">提交渲染后生成代理片</div>
                </div>
              )}
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <EngineTag engine={shot.render_engine} />
              <span className="mono muted">{timecode(durationMs, true)}</span>
            </div>
            {audioCandidates.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="hint">配音候选（三候选原则）</div>
                {audioCandidates.map((c) => (
                  <div key={c.id} className="row" style={{ gap: 8, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 8, background: c.state === 'selected' ? 'var(--gold-soft)' : 'transparent' }}>
                    <span className="mono" style={{ width: 18, color: 'var(--text-3)' }}>{c.idx}</span>
                    <audio src={'/api/v1/assets/' + c.asset_id + '/raw'} controls style={{ height: 28, flex: 1, minWidth: 0 }} />
                    <span className="mono muted" style={{ fontSize: 10.5 }}>{seconds(c.duration_ms ?? 0)}s</span>
                    <Button size="small" onClick={() => selectCandidate(c.id)} disabled={c.state === 'selected'}>
                      {c.state === 'selected' ? '已选' : '选用'}
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {videoCandidates.length > 0 && (
              <div className="hint">视频候选：{videoCandidates.length} 条 · 已选 {videoCandidates.find((c) => c.state === 'selected')?.idx ?? 1}</div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="台词（支持内联表演标签：（笑）（停顿半秒）（压低声音））">
              <textarea
                className="textarea"
                rows={4}
                value={String(draft.lines ?? '')}
                onChange={(e) => setDraft((d) => ({ ...d, lines: e.target.value }))}
                onBlur={() => patch({ lines: String(draft.lines ?? '').split('\n').filter(Boolean) })}
              />
            </Field>

            <Field label="情绪 chips（点选即写入 emotion_instruction）">
              <div className="chips">
                {emotions.map((e) => (
                  <Chip key={e.id} on={draft.emotion === e.id} onClick={() => { setDraft((d) => ({ ...d, emotion: e.id, emotion_instruction: e.instruction, tts_speed: e.speed })); void patch({ emotion: e.id, emotion_instruction: e.instruction }, '情绪：' + e.label); }}>
                    {e.label}
                  </Chip>
                ))}
              </div>
            </Field>

            <div className="grid-2">
              <Field label="机位">
                <select className="select" value={String(draft.camera ?? '')} onChange={(e) => { setDraft((d) => ({ ...d, camera: e.target.value })); void patch({ camera: e.target.value }); }}>
                  {cameras.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </Field>
              <Field label="语速">
                <input
                  className="input mono"
                  type="number"
                  step="0.01"
                  min="0.6"
                  max="1.6"
                  value={Number(draft.tts_speed ?? 1)}
                  onChange={(e) => setDraft((d) => ({ ...d, tts_speed: Number(e.target.value) }))}
                  onBlur={() => patch({ tts_speed: Number(draft.tts_speed ?? 1) })}
                />
              </Field>
            </div>

            <Field label="渲染引擎（正交于视觉风格）">
              <div className="chips">
                <Chip on={draft.render_engine === 'muse_api'} tone="gold" icon="cloud" onClick={() => { if (shot.privacy) { notify('涉敏镜头必须本地生成', 'error'); return; } setDraft((d) => ({ ...d, render_engine: 'muse_api' })); void patch({ render_engine: 'muse_api' }); }}>云端生成</Chip>
                <Chip on={draft.render_engine === 'comfy_h3'} tone="jade" icon="monitor" onClick={() => { setDraft((d) => ({ ...d, render_engine: 'comfy_h3' })); void patch({ render_engine: 'comfy_h3' }); }}>本地生成</Chip>
              </div>
            </Field>

            <div className="row" style={{ gap: 16 }}>
              <Toggle on={Boolean(draft.lipsync_required)} onChange={(v) => { setDraft((d) => ({ ...d, lipsync_required: v })); void patch({ lipsync_required: v }); }} label="口型对齐" />
              <div className="spacer" />
              <span className="hint">时长 <b className="mono" style={{ color: durationWarn ? 'var(--warn)' : 'var(--text-1)' }}>{(durationMs / 1000).toFixed(2)}s</b>
                {durationWarn && ' · 超出 2–8s 建议区间（仅警告）'}
              </span>
            </div>

            <Field label="画面提示词（风格前缀 + 内容 + 锚定 + 镜头语言）">
              <textarea
                className="textarea"
                rows={3}
                value={String(draft.visual_prompt ?? '')}
                onChange={(e) => setDraft((d) => ({ ...d, visual_prompt: e.target.value }))}
                onBlur={() => patch({ visual_prompt: draft.visual_prompt })}
              />
            </Field>
            <Field label="负向词">
              <textarea
                className="textarea"
                rows={2}
                value={String(draft.negative_prompt ?? '')}
                onChange={(e) => setDraft((d) => ({ ...d, negative_prompt: e.target.value }))}
                onBlur={() => patch({ negative_prompt: draft.negative_prompt })}
              />
            </Field>

            {overCap ? (
              <div className="danger-block">
                <b>本段已达 {segmentUsed}s，超出 300 秒上限 {compliance?.exceed_sec}s。</b>
                <div style={{ marginTop: 4 }}>{compliance?.split_suggestion ?? '请删减镜头或拆分段落'}；提交按钮已禁用，不允许绕过。</div>
              </div>
            ) : nearCap ? (
              <div className="warn-block">本段已用 {segmentUsed}s / {segmentCap}s，接近上限，剩余 {compliance?.remaining_sec}s。建议为花字与音效预留余量。</div>
            ) : null}

            <div>
              <div className="hint" style={{ marginBottom: 6 }}>任务链</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {tasks.length === 0 && <div className="hint">尚未提交渲染</div>}
                {tasks.slice(-6).map((t) => (
                  <div key={t.id} className="row" style={{ gap: 8, fontSize: 11.5 }}>
                    <span className="mono muted" style={{ width: 54 }}>#{t.id}</span>
                    <Pill>{taskTypeLabel(t.task_type)}</Pill>
                    <TaskPill status={t.status} />
                    <span className="mono muted">{t.progress}%</span>
                    {t.error_code && <span className="pill down">{errorLabel(t.error_code)}</span>}
                    <div className="spacer" />
                    {['failed', 'canceled'].includes(t.status) && <Button size="small" icon="refresh" onClick={async () => { await api.retryTask(t.id); notify('已重试任务 #' + t.id, 'success'); }}>重试</Button>}
                  </div>
                ))}
              </div>
            </div>

            {shot.error_code && <div className="danger-block">{errorLabel(shot.error_code)} · {m?.error_codes.find((e) => e.code === shot.error_code)?.uiHint ?? ''}</div>}
            <div className="hint">提示：{shortText(shot.text_clean ?? '', 60)}</div>
          </div>
        </div>
      )}
    </Modal>
  );
}
