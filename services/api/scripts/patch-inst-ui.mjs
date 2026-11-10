import fs from 'node:fs';
const W = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\web\\src\\";
function pf(rel, fn) { const p = W + rel; let s = fs.readFileSync(p, 'utf8'); const o = fn(s); if (o !== s) { fs.writeFileSync(p, o); console.log('patched', rel); } }
pf('lib\\api.ts', (s) => s.includes('instantiateTemplate') ? s : s.replace(
  "  applyTemplate: (key: string, body: Record<string, unknown>) =>",
  "  instantiateTemplate: (key: string, body: Record<string, unknown>) => request<{ project_id: number }>('/templates/' + key + '/instantiate', { method: 'POST', body: JSON.stringify(body) }),\n  applyTemplate: (key: string, body: Record<string, unknown>) =>"
));
pf('pages\\Templates.tsx', (s) => s.includes('instantiateTemplate') ? s : s.replace(
  "                  {t.template_type === 'variety_show' && (",
  "                  {t.template_type === 'engineering_template' && (\n                    <Button size=\"small\" kind=\"primary\" onClick={async () => {\n                      try { const r = await api.instantiateTemplate(t.template_key, { name: t.display_name + ' · 实例' }); notify('已实例化工程模板', 'success'); navigate('/project/' + r.project_id + '/overview'); }\n                      catch (err) { notify(String((err as Error).message), 'error'); }\n                    }}>实例化</Button>\n                  )}\n                  {t.template_type === 'variety_show' && ("
));
