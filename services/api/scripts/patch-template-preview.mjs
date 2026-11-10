import fs from 'node:fs';
const R = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\";
const W = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\web\\src\\";
function pf(p, fn) { let s = fs.readFileSync(p, 'utf8'); const o = fn(s); if (o !== s) { fs.writeFileSync(p, o); console.log('patched', p.split('\\').pop()); } }

// 预览片路由：直接托管 deliverables/templates 下同名 mp4
pf(R + 'routes\\templates.ts', (s) => {
  if (s.includes('/preview')) return s;
  return s.replace("  app.post('/templates/:key/apply'", `  // 模板验证片（20s 左右），供模板库直接播放
  app.get('/templates/:key/preview', async (req, reply) => {
    const key = String((req.params as { key: string }).key);
    const file = path.join(process.cwd(), '..', '..', 'deliverables', 'templates', key + '.mp4');
    if (!fs.existsSync(file)) { reply.status(404).type('text/plain').send('没有预览片'); return; }
    const stat = fs.statSync(file);
    const range = String((req.headers as Record<string, string | undefined>).range ?? '').trim();
    if (/^bytes=\\d*-\\d*$/.test(range)) {
      const [s0, e0] = range.replace('bytes=', '').split('-');
      const start = s0 ? Number(s0) : 0;
      const end = e0 ? Math.min(Number(e0), stat.size - 1) : stat.size - 1;
      reply.status(206).type('video/mp4').header('Accept-Ranges', 'bytes').header('Content-Range', 'bytes ' + start + '-' + end + '/' + stat.size).header('Content-Length', String(end - start + 1));
      return reply.send(fs.createReadStream(file, { start, end }));
    }
    reply.type('video/mp4').header('Accept-Ranges', 'bytes').header('Content-Length', String(stat.size));
    return reply.send(fs.createReadStream(file));
  });

  app.post('/templates/:key/apply'`);
});
if (!fs.readFileSync(R + 'routes\\templates.ts', 'utf8').includes("import path")) {
  pf(R + 'routes\\templates.ts', (s) => s.replace("import fs from 'node:fs';", "import fs from 'node:fs';\nimport path from 'node:path';"));
}

// 模板页：预览片弹窗
pf(W + 'pages\\Templates.tsx', (s) => {
  if (s.includes('previewKey')) return s;
  let out = s.replace("  const [view, setView] = useState<Template | null>(null);", "  const [view, setView] = useState<Template | null>(null);\n  const [previewKey, setPreviewKey] = useState<string | null>(null);");
  out = out.replace("                  <Button size=\"small\" onClick={() => setView(t)}>查看结构</Button>", "                  <Button size=\"small\" onClick={() => setView(t)}>查看结构</Button>\n                  {t.template_type === 'variety_show' && <Button size=\"small\" icon=\"play\" onClick={() => setPreviewKey(t.template_key)}>预览片</Button>}");
  out = out.replace("      <Modal open={view != null}", `      <Modal open={previewKey != null} wide title={'模板验证片'} onClose={() => setPreviewKey(null)} footer={<Button kind=\"ghost\" onClick={() => setPreviewKey(null)}>关闭</Button>}>
        {previewKey && <video key={previewKey} src={'/api/v1/templates/' + previewKey + '/preview'} controls playsInline style={{ width: '100%', maxHeight: 520, background: '#000', borderRadius: 10 }} />}
      </Modal>

      <Modal open={view != null}`);
  return out;
});
