import fs from 'node:fs';
const O = 'D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-stage/web/src/pages/Overview.tsx';
let s = fs.readFileSync(O, 'utf8');
const start = s.indexOf('      {(((data as unknown as { episodes?');
if (start >= 0) {
  const end = s.indexOf('\n      )}\n', start);
  if (end > start) {
    s = s.slice(0, start) + s.slice(end + '\n      )}\n'.length);
    fs.writeFileSync(O, s);
    console.log('reverted', start, end);
  } else console.log('end missing');
} else console.log('start missing');
console.log('stats rows', (s.match(/className="stats-row"/g) || []).length);
