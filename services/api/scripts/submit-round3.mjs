const ids = [1145,1146,1147,1148,1149,1150,1151,1152,1153,1154,1155,1156,1157,1158,1159,1160,1161,1162];
for (const id of ids) {
  const r = await fetch('http://127.0.0.1:8787/api/v1/shots/' + id + '/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force: true, candidates: 1 }) });
  console.log(id, r.status);
}
