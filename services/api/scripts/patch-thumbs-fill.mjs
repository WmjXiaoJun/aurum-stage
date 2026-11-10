import fs from 'node:fs';
const W = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\web\\src\\";
function pf(rel, fn) { const p = W + rel; let s = fs.readFileSync(p, 'utf8'); const o = fn(s); if (o !== s) { fs.writeFileSync(p, o); console.log('patched', rel); } }

// 角色库：模糊底 + contain，避免左右留白
pf('pages\\CharactersLibrary.tsx', (s) => s.replace(
  "                {c.cover_url ? (\n                  <img src={c.cover_url} alt={c.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />\n                ) : (",
  "                {c.cover_url ? (\n                  <>\n                    <img src={c.cover_url} alt=\"\" aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(18px) saturate(1.1)', opacity: 0.55, transform: 'scale(1.15)' }} />\n                    <img src={c.cover_url} alt={c.name} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }} />\n                  </>\n                ) : ("
));

// 模板封面：模糊底 + contain
pf('pages\\Templates.tsx', (s) => s.replace(
  "                {t.template_type === 'variety_show' ? (\n                  <img\n                    src={'/api/v1/templates/' + t.template_key + '/cover'}\n                    alt={t.display_name}\n                    style={{ width: 132, height: 74, objectFit: 'contain', background: '#06080b', borderRadius: 8, border: '1px solid var(--border)' }}\n                  />\n                ) : <Icon name=\"template\" size={16} />}",
  "                {t.template_type === 'variety_show' ? (\n                  <div style={{ position: 'relative', width: 160, height: 90, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', background: '#06080b' }}>\n                    <img src={'/api/v1/templates/' + t.template_key + '/cover'} alt=\"\" aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(16px)', opacity: 0.55, transform: 'scale(1.15)' }} />\n                    <img src={'/api/v1/templates/' + t.template_key + '/cover'} alt={t.display_name} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }} />\n                  </div>\n                ) : <Icon name=\"template\" size={16} />}"
));
