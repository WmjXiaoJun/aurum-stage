import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\web\\src\\components\\Layout.tsx";
let s = fs.readFileSync(p, 'utf8');
if (!s.includes('composeBanner')) {
  s = s.replace("import React from 'react';", "import React, { useState } from 'react';");
  s = s.replace("import { useApp } from '../lib/store';", "import { useApp, useEvents } from '../lib/store';");
  s = s.replace("  const { meta, wsOpen } = useApp();", "  const { meta, wsOpen } = useApp();\n  const [composeBanner, setComposeBanner] = useState<{ url: string; duration: number } | null>(null);\n  useEvents(project?.id ?? null, (event) => {\n    if (event.type === 'compose.success') {\n      const payload = event.payload as { video_url?: string; duration_sec?: number };\n      setComposeBanner({ url: String(payload?.video_url ?? ''), duration: Number(payload?.duration_sec ?? 0) });\n    }\n  });");
  s = s.replace("        <main className=\"content\">{children}</main>", `        <main className="content">
          {composeBanner && (
            <div style={{ position: 'sticky', top: 0, zIndex: 20, marginBottom: 12, padding: '10px 14px', borderRadius: 10, background: 'linear-gradient(90deg, rgba(212,184,126,.18), rgba(20,26,35,.92))', border: '1px solid var(--gold)', display: 'flex', gap: 12, alignItems: 'center' }}>
              <span style={{ color: 'var(--gold-light)', fontWeight: 600 }}>成片已生成</span>
              <span className="hint">{composeBanner.duration ? composeBanner.duration + ' 秒' : ''} · 自动合成完成，已登记到导出记录</span>
              <span style={{ flex: 1 }} />
              {composeBanner.url && <a className="btn small" href={composeBanner.url} target="_blank" rel="noreferrer">播放</a>}
              {composeBanner.url && <a className="btn small" href={composeBanner.url} download>下载</a>}
              <button type="button" className="btn small" onClick={() => setComposeBanner(null)}>关闭</button>
            </div>
          )}
          {children}
        </main>`);
  fs.writeFileSync(p, s);
  console.log('banner added');
} else console.log('already');
