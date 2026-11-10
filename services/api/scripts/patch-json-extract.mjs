import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\domain\\skills-service.ts";
let s = fs.readFileSync(p, 'utf8');
if (!s.includes('function extractJson')) {
  s = s.replace("async function llmJson(", `function extractJson(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === '\\\\') { esc = true; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}

async function llmJson(`);
  s = s.replace("  const match = content.match(/\\{[\\s\\S]*\\}/);\n  if (!match) throw new Error('模型没有返回 JSON');\n  return JSON.parse(match[0]) as Record<string, unknown>;",
    "  const raw = extractJson(content);\n  if (!raw) throw new Error('模型没有返回 JSON');\n  return JSON.parse(raw) as Record<string, unknown>;");
  fs.writeFileSync(p, s);
  console.log('json extract patched');
} else console.log('already');
