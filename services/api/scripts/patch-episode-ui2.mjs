import fs from 'node:fs';
const W = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\web\\src\\";
function pf(p, fn) { let s = fs.readFileSync(p, 'utf8'); const o = fn(s); if (o !== s) { fs.writeFileSync(p, o); console.log('patched', p.split('\\').pop()); } else console.log('nochange', p); }
pf(W + 'lib\\api.ts', (s) => s.replace("  overview: (id: number) => request<import('./types').Overview>('/projects/' + id + '/overview'),",
  "  overview: (id: number, episodeId?: number) => request<import('./types').Overview>('/projects/' + id + '/overview' + (episodeId ? '?episode_id=' + episodeId : '')),"));
pf(W + 'pages\\Overview.tsx', (s) => {
  const anchor = s.indexOf("api.overview(projectId)");
  if (anchor < 0) return s;
  let out = s.replace("api.overview(projectId)", "api.overview(projectId, episodeParam || undefined)");
  out = out.replace("  const [search, setSearch] = useState('');", "  const episodeParam = Number(new URLSearchParams(window.location.search).get('ep') ?? 0);\n  const [search, setSearch] = useState('');");
  // 在 stats-row 前插入分期切换
  const idx = out.indexOf('<div className="stats-row">');
  if (idx > 0) {
    const block = `{((data?.episodes ?? []) as Array<Record<string, unknown>>).length > 0 && (
        <div className="row wrap" style={{ gap: 8 }}>
          <span className="hint">分期</span>
          <Chip on={!episodeParam} onClick={() => navigate('/project/' + projectId + '/overview')}>全部</Chip>
          {((data?.episodes ?? []) as Array<Record<string, unknown>>).map((ep) => (
            <Chip key={String(ep.id)} on={episodeParam === Number(ep.id)} onClick={() => navigate('/project/' + projectId + '/overview?ep=' + ep.id)}>
              {String(ep.title)}
            </Chip>
          ))}
        </div>
      )}

      `;
    out = out.slice(0, idx) + block + out.slice(idx);
  }
  return out;
});
