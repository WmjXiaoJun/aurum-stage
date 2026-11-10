const base = 'http://127.0.0.1:8188';
const info = await fetch(base + '/object_info').then((r) => r.json());
const types = ['UNETLoader','LoraLoaderModelOnly','MiniMaxH3SigmaShift','CLIPLoader','VAELoader','MiniMaxH3ImageToVideo','BasicGuider','RandomNoise','KSamplerSelect','BasicScheduler','SamplerCustomAdvanced','VAEDecodeTiled','VAEDecodeAudio','CreateVideo','SaveVideo','LoadImage'];
for (const t of types) {
  const def = info[t];
  if (!def) { console.log(t, 'MISSING'); continue; }
  const req = def.input?.required ?? {};
  const opt = def.input?.optional ?? {};
  const fmt = (o) => Object.entries(o).map(([k, v]) => {
    const type = Array.isArray(v?.[0]) ? 'COMBO(' + v[0].slice(0, 3).join('|') + '...)' : String(v?.[0]);
    return k + ':' + type + (v?.[1]?.default !== undefined ? '=' + JSON.stringify(v[1].default) : '');
  }).join(', ');
  console.log('##', t, '| output:', (def.output ?? []).join(','), '| req:', fmt(req), '| opt:', fmt(opt));
}
const stats = await fetch(base + '/system_stats').then((r) => r.json());
console.log('device', JSON.stringify(stats.devices?.[0] ?? stats));
