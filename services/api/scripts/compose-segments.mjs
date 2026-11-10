const segs = [82,83,84,85,86,87];
for (const seg of segs) {
  const r = await fetch('http://127.0.0.1:8787/api/v1/projects/45/compose', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ segment_id: seg, bgm: true }) });
  const t = await r.text();
  console.log(seg, r.status, t.slice(0, 220));
}
