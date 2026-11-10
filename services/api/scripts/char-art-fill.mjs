import fs from 'node:fs';
const API = 'http://127.0.0.1:8787/api/v1';
const list = await fetch(API + '/characters').then((r) => r.json());
const need = list.filter((c) => !c.cover_url);
console.log('need art', need.map((c) => c.id + ':' + c.name).join(', '));
for (const c of need) {
  try {
    const res = await fetch(API + '/characters/' + c.id + '/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modes: ['portrait'], count: 1, style: c.project_style || 'photoreal' }) });
    const data = await res.json();
    console.log('char', c.id, 'assets', (data.assets || []).length);
  } catch (e) { console.log('fail', c.id, String(e).slice(0, 120)); }
}
console.log('done');
process.exit(0);
