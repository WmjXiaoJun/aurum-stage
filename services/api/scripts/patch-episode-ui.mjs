import fs from 'node:fs';
const W = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\web\\src\\";
function pf(p, fn) { let s = fs.readFileSync(p, 'utf8'); const o = fn(s); if (o !== s) { fs.writeFileSync(p, o); console.log('patched', p.split('\\').pop()); } }
pf(W + 'lib\\api.ts', (s) => s.includes('episodes:') ? s : s.replace("  board: () =>", "  episodes: (id: number) => request<Array<Record<string, unknown>>>('/projects/' + id + '/episodes'),\n  board: () =>"));
pf(W + 'pages\\Overview.tsx', (s) => {
  if (s.includes('期') && s.includes('episodeId')) return s;
  let out = s.replace("  const { data, loading, error, reload } = useAsync(() => api.overview(projectId), [projectId]);",
    "  const episodeParam = Number(new URLSearchParams(window.location.search).get('ep') ?? 0);\n  const { data, loading, error, reload } = useAsync(() => api.overview(projectId, episodeParam || undefined), [projectId, episodeParam]);");
  out = out.replace("      <div className=\"stats-row\">", `      {((data?.episodes ?? []) as Array<Record<string, unknown>>).length > 0 && (
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

      <div className="stats-row">`);
  return out;
});
