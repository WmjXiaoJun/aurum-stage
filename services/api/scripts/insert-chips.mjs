import fs from 'node:fs';
const O = 'D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-stage/web/src/pages/Overview.tsx';
let s = fs.readFileSync(O, 'utf8');
if (!s.includes('分期')) {
  const anchor = s.indexOf('  return (\n    <>');
  if (anchor < 0) { console.log('anchor missing'); process.exit(1); }
  const at = anchor + '  return (\n    <>'.length;
  const block = [
    '',
    '      {(((data as unknown as { episodes?: Array<{ id: number; seq: number; title: string }> })?.episodes) ?? []).length > 0 && (',
    '        <div className="row wrap" style={{ gap: 8, alignItems: \'center\' }}>',
    '          <span className="hint">分期</span>',
    '          <Chip on={!episodeParam} onClick={() => navigate(\'/project/\' + projectId + \'/overview\')}>全部</Chip>',
    '          {(((data as unknown as { episodes?: Array<{ id: number; seq: number; title: string }> })?.episodes) ?? []).map((ep) => (',
    '            <Chip key={ep.id} on={episodeParam === ep.id} onClick={() => navigate(\'/project/\' + projectId + \'/overview?ep=\' + ep.id)}>',
    '              {ep.title}',
    '            </Chip>',
    '          ))}',
    '        </div>',
    '      )}',
    ''
  ].join('\n');
  s = s.slice(0, at) + block + s.slice(at);
  fs.writeFileSync(O, s);
  console.log('inserted');
} else console.log('already');
