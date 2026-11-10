import fs from 'node:fs';
const R = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\";
function pf(p, fn) { let s = fs.readFileSync(p, 'utf8'); const o = fn(s); if (o !== s) { fs.writeFileSync(p, o); console.log('patched', p.split('\\').pop()); } }

// 新建角色后自动：推断音色 + 出全套图
pf(R + 'routes\\characters.ts', (s) => {
  if (s.includes('autoSetupCharacter')) return s;
  let out = s.replace("import { generateCharacterArt, characterFiles, type GenerateArtInput } from '../adapters/character-art.js';",
    "import { generateCharacterArt, characterFiles, type GenerateArtInput } from '../adapters/character-art.js';\nimport { autoSetupCharacter } from '../domain/character-autopack.js';");
  out = out.replace("    reply.status(201);\n    return withRelations(get('SELECT * FROM character_asset WHERE id = ?', [res.lastInsertRowid]) as Record<string, unknown>);",
    "    autoSetupCharacter(Number(res.lastInsertRowid));\n    reply.status(201);\n    return withRelations(get('SELECT * FROM character_asset WHERE id = ?', [res.lastInsertRowid]) as Record<string, unknown>);");
  return out;
});

// 手动触发自动补全（出图/音色）
pf(R + 'routes\\characters.ts', (s) => {
  if (s.includes("'/characters/:id/auto'")) return s;
  return s.replace("  /** 角色音色绑定", `  /** 一键自动：全套形象图 + 音色（用于老角色补齐） */
  app.post('/characters/:id/auto', async (req) => {
    const id = Number((req.params as { id: string }).id);
    autoSetupCharacter(id);
    return { ok: true, queued: true };
  });

  /** 角色音色绑定`);
});
