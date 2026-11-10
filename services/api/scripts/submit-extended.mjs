const ids = [1127,1128,1129,1130,1131,1132,1133,1134,1135,1136,1137,1138,1139,1140,1141,1142,1143,1144];
for (const id of ids) {
  const r = await fetch('http://127.0.0.1:8787/api/v1/shots/' + id + '/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force: true, candidates: 1 }) });
  const t = await r.text();
  console.log(id, r.status, t.slice(0, 120));
}
