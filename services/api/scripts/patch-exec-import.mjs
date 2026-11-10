import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\scheduler\\executors.ts";
let s = fs.readFileSync(p, 'utf8');
if (!/import \{[^}]*assetKey[^}]*\} from '\.\.\/adapters\/storage\.js'/.test(s)) {
  if (/import \{([^}]*)\} from '\.\.\/adapters\/storage\.js'/.test(s)) {
    s = s.replace(/import \{([^}]*)\} from '\.\.\/adapters\/storage\.js'/, (m, names) => "import {" + names + ", assetKey } from '../adapters/storage.js';");
  } else {
    s = s.replace("import { generateWithComfy, generateWithMuse, type VideoSpec } from '../adapters/video.js';", "import { generateWithComfy, generateWithMuse, type VideoSpec } from '../adapters/video.js';\nimport { assetKey } from '../adapters/storage.js';");
  }
  fs.writeFileSync(p, s);
  console.log('assetKey imported');
} else console.log('ok');
