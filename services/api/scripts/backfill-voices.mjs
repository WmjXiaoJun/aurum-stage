/** 一次性补齐：给还没有音色的角色自动推断并绑定 Breeze 音色 */
process.env.AURUM_DATA_DIR ??= 'D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-data';
const { all, get, run } = await import('../src/db/index.js');
const { autoBindVoice } = await import('../src/domain/character-autopack.js');
const chars = all('SELECT id, name, persona, role_id FROM character_asset WHERE is_active = 1 ORDER BY id');
let bound = 0;
for (const c of chars) {
  const has = get("SELECT id FROM voice_asset WHERE project_id = (SELECT project_id FROM character_asset WHERE id = ?) AND role_id = ? AND provider = 'breeze' AND is_active = 1", [Number(c.id), String(c.role_id)]);
  if (has) continue;
  const p = await autoBindVoice(Number(c.id));
  if (p) bound += 1;
  console.log(c.id, c.name, p ? p.instruction : 'fail');
}
console.log('bound', bound, 'of', chars.length);
void run;
process.exit(0);
