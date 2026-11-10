import fs from 'node:fs';
const W = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\web\\src\\";
const R = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\";
function pf(p, fn) { let s = fs.readFileSync(p, 'utf8'); const o = fn(s); if (o !== s) { fs.writeFileSync(p, o); console.log('patched', p.split('\\').pop()); } }

// A. 项目卡与模板封面：铺满裁切
pf(W + 'pages\\Projects.tsx', (s) => s.replace(
  "                    <img src={covers[p.id]} alt={p.name} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }} />",
  "                    <img src={covers[p.id]} alt={p.name} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />"
));
pf(W + 'pages\\Templates.tsx', (s) => s.replace(
  "                    <img src={'/api/v1/templates/' + t.template_key + '/cover'} alt={t.display_name} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }} />",
  "                    <img src={'/api/v1/templates/' + t.template_key + '/cover'} alt={t.display_name} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />"
));

// B. 角色页：音色绑定 + 试音（引擎可选 Breeze / edge）
pf(W + 'pages\\Characters.tsx', (s) => {
  if (s.includes('bindVoice')) return s;
  let out = s.replace("  const [auditionBusy, setAuditionBusy] = useState<number | null>(null);", "  const [auditionBusy, setAuditionBusy] = useState<number | null>(null);\n  const [voiceEngine, setVoiceEngine] = useState<Record<number, string>>({});");
  out = out.replace("  const audition = async (c: Character) => {", `  const bindVoice = async (c: Character, engine: string) => {
    try {
      await api.bindCharacterVoice(c.id, { engine, voice_id: engine === 'breeze' ? 'breeze_role_' + c.role_type : 'v_host' });
      notify('已绑定音色：' + (engine === 'breeze' ? '本地 Breeze TTS 2' : '云端 edge-tts'), 'success');
      reload();
    } catch (err) { notify(String((err as Error).message), 'error'); }
  };

  const audition = async (c: Character) => {`);
  out = out.replace("                  <Button size=\"small\" icon=\"wave\" onClick={() => audition(c)} disabled={auditionBusy === c.id}>{auditionBusy === c.id ? '试音中…' : '试音'}</Button>",
    "                  <Button size=\"small\" icon=\"wave\" onClick={() => audition(c)} disabled={auditionBusy === c.id}>{auditionBusy === c.id ? '试音中…' : '试音'}</Button>\n                  <select className=\"select\" style={{ height: 28, fontSize: 12 }} value={voiceEngine[c.id] ?? (c.voice ? (String((c.voice as unknown as { engine?: string }).engine ?? 'edge').includes('breeze') ? 'breeze' : 'edge') : 'edge')} onChange={(e) => { setVoiceEngine({ ...voiceEngine, [c.id]: e.target.value }); void bindVoice(c, e.target.value); }}>\n                    <option value=\"breeze\">本地 Breeze 音色</option>\n                    <option value=\"edge\">云端 edge 音色</option>\n                  </select>");
  return out;
});

// 导航：去掉独立「配音」入口（并入角色）
pf(W + 'components\\Layout.tsx', (s) => s.replace("  { key: 'voices', label: '配音', icon: 'voice' },\n", ""));
