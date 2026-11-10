import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\web\\src\\lib\\api.ts";
let s = fs.readFileSync(p, 'utf8');
if (!s.includes('autoCharacter')) {
  s = s.replace("  bindCharacterVoice:", "  autoCharacter: (id: number) => request<Record<string, unknown>>('/characters/' + id + '/auto', { method: 'POST', body: '{}' }),\n  bindCharacterVoice:");
  fs.writeFileSync(p, s);
  console.log('client patched');
} else console.log('already');
