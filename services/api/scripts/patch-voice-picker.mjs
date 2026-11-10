import fs from 'node:fs';
const W = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\web\\src\\";
function pf(p, fn) { let s = fs.readFileSync(p, 'utf8'); const o = fn(s); if (o !== s) { fs.writeFileSync(p, o); console.log('patched', p.split('\\').pop()); } }

// 客户端：音色预设 + 试音支持 preset
pf(W + 'lib\\api.ts', (s) => {
  let out = s;
  if (!out.includes('voicePresets')) out = out.replace("  board: () =>", "  voicePresets: () => request<Array<{ id: string; label: string; instruction: string }>>('/voices'),\n  board: () =>");
  return out;
});

pf(W + 'pages\\CharactersLibrary.tsx', (s) => {
  let out = s.replace("style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }} />", "style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />");
  out = out.replace("  const [busy, setBusy] = useState(false);", "  const [busy, setBusy] = useState(false);\n  const { data: presets } = useAsync(() => api.voicePresets(), []);\n  const [presetId, setPresetId] = useState('laozhou');\n  const [voiceBusy, setVoiceBusy] = useState(false);");
  out = out.replace("  const autoFill = async () => {", `  const auditionPreset = async () => {
    if (!detail) return;
    setVoiceBusy(true);
    try {
      const r = await api.auditionCharacter(detail.id, { text: '这一期，我们聊点真的。', preset: presetId });
      const audio = new Audio(r.url);
      void audio.play();
      notify('试听：' + (presets ?? []).find((p) => p.id === presetId)?.label, 'success');
    } catch (e) { notify(String((e as Error).message), 'error'); }
    finally { setVoiceBusy(false); }
  };

  const applyPreset = async () => {
    if (!detail) return;
    setVoiceBusy(true);
    try { await api.bindCharacterVoice(detail.id, { engine: 'breeze', preset: presetId }); notify('已更换音色', 'success'); reload(); }
    catch (e) { notify(String((e as Error).message), 'error'); }
    finally { setVoiceBusy(false); }
  };

  const autoFill = async () => {`);
  out = out.replace("              <div className=\"hint\">种子 {detail.seed ?? '—'} · 音色 {detail.voice ? (String(detail.voice.provider ?? '').includes('breeze') ? '本地 Breeze 模型' : '云端 edge') : '未绑定'}</div>",
    `              <div className="hint">种子 {detail.seed ?? '—'} · 音色 {detail.voice ? (String(detail.voice.provider ?? '').includes('breeze') ? '本地 Breeze 模型' : '云端 edge') : '未绑定'}</div>
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="hint">更换音色（换完立即用于镜头配音）</div>
                <select className="select" value={presetId} onChange={(e) => setPresetId(e.target.value)}>
                  {(presets ?? []).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
                <div className="row" style={{ gap: 8 }}>
                  <Button size="small" onClick={auditionPreset} disabled={voiceBusy}>试听</Button>
                  <Button size="small" kind="primary" onClick={applyPreset} disabled={voiceBusy}>应用</Button>
                </div>
                {detail.voice && <div className="hint">当前指导：{String(detail.voice.instruction ?? '—')}</div>}
              </div>`);
  return out;
});
