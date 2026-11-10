import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\web\\src\\pages\\Templates.tsx";
let s = fs.readFileSync(p, 'utf8');
const start = s.indexOf("                {t.template_type === 'variety_show' ? (");
const endMark = "                ) : <Icon name=\"template\" size={16} />}";
const end = s.indexOf(endMark);
if (start >= 0 && end > start) {
  const replacement = `                <div style={{ position: 'relative', width: 160, height: 90, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', background: '#06080b', display: 'grid', placeItems: 'center' }}>
                  <Icon name="template" size={18} />
                  <img
                    src={'/api/v1/templates/' + t.template_key + '/cover'}
                    alt={t.display_name}
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                </div>`;
  s = s.slice(0, start) + replacement + s.slice(end + endMark.length);
  fs.writeFileSync(p, s);
  console.log('covers for all templates');
} else console.log('anchor not found', start, end);
