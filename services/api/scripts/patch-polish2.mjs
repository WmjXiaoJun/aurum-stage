import fs from 'node:fs';
const R = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\";
const W = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\web\\src\\";
function pf(p, fn) { let s = fs.readFileSync(p, 'utf8'); const o = fn(s); if (o !== s) { fs.writeFileSync(p, o); console.log('patched', p.split('\\').pop()); } }

pf(R + 'adapters\\compose.ts', (s) => {
  if (s.includes('manifest.deliverable')) return s;
  return s.replace("  const manifestKey = baseKey + '/compose-manifest.json';", "  (manifest as Record<string, unknown>).deliverable = deliverable;\n  const manifestKey = baseKey + '/compose-manifest.json';");
});

// 导出页：显示归档文件名
pf(W + 'pages\\Export.tsx', (s) => {
  if (s.includes('已归档')) return s;
  return s.replace("                        {e.error_msg ? <span className=\"hint\" style={{ maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{humanizeTech(String(e.error_msg))}</span> : null}",
    `                        {(() => {
                          try {
                            const man = JSON.parse(String((e as { manifest?: string }).manifest ?? '{}')) as { deliverable?: string };
                            if (!man.deliverable) return null;
                            const name = man.deliverable.split(/[\\\\/]/).pop();
                            return <span className="hint">已归档：{name}</span>;
                          } catch { return null; }
                        })()}
                        {e.error_msg ? <span className="hint" style={{ maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{humanizeTech(String(e.error_msg))}</span> : null}`);
});
