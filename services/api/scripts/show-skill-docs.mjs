const keys = ['variety-outline','variety-script','variety-storyboard'];
for (const key of keys) {
  const r = await fetch('http://127.0.0.1:8787/api/v1/projects/45/skills/' + key);
  const d = await r.json();
  const b = d.body || {};
  console.log('=====', key, 'v' + d.version, d.status);
  if (key === 'variety-outline') {
    console.log('定位:', JSON.stringify(b.positioning));
    console.log('环节:', (b.segments || []).map(s => s.title + '(' + s.duration_sec + 's)').join(' / '));
    console.log('情绪点:', (b.beats || []).slice(0, 5).map(x => x.type + ':' + x.desc).join(' | '));
  }
  if (key === 'variety-script') {
    const seg = (b.segments || [])[0] || {};
    console.log('第一段:', seg.title);
    for (const line of ((seg.rounds || [])[0]?.lines || []).slice(0, 4)) console.log(' ', line.speaker, ':', line.text);
  }
  if (key === 'variety-storyboard') {
    const seg = (b.segments || [])[0] || {};
    console.log('第一段时长:', seg.duration_sec);
    for (const sh of (seg.shots || []).slice(0, 4)) console.log(' ', sh.scale, sh.duration_sec + 's', sh.frame_prompt?.slice(0, 60));
    console.log('H3:', String(seg.h3_prompt || '').slice(0, 160));
  }
}
