import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\web\\src\\pages\\Templates.tsx";
let s = fs.readFileSync(p, 'utf8');
if (!s.includes('applyTemplate')) {
  s = s.replace("import { TEMPLATE_TYPE_LABEL, templateLabel, styleName, describeConstraints } from '../lib/zh';", "import { TEMPLATE_TYPE_LABEL, templateLabel, styleName, describeConstraints } from '../lib/zh';\nimport { navigate } from '../lib/router';");
  s = s.replace("                  <Button size=\"small\" onClick={() => setView(t)}>查看结构</Button>",
    "                  <Button size=\"small\" onClick={() => setView(t)}>查看结构</Button>\n                  {t.template_type === 'variety_show' && (\n                    <>\n                      {[{ id: 'photoreal', label: '真实' }, { id: 'anime_2d', label: '2D' }, { id: 'cgi_3d', label: '3D' }].map((st) => (\n                        <Button\n                          key={st.id}\n                          size=\"small\"\n                          kind=\"primary\"\n                          onClick={async () => {\n                            try {\n                              const r = await api.applyTemplate(t.template_key, { visual_style: st.id, name: t.display_name + ' · ' + st.label });\n                              notify('已用模板建项目（' + st.label + '）', 'success');\n                              navigate('/project/' + r.project_id + '/overview');\n                            } catch (err) { notify(String((err as Error).message), 'error'); }\n                          }}\n                        >{st.label}</Button>\n                      ))}\n                    </>\n                  )}");
  fs.writeFileSync(p, s);
  console.log('templates patched');
} else console.log('already');
