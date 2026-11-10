import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\scheduler\\scheduler.ts";
let s = fs.readFileSync(p, 'utf8');
if (!s.includes("from './task-service.js'")) {
  s = s.replace("import { depsSatisfied, executeTask, needsAgent, selectNode } from './executors.js';",
    "import { depsSatisfied, executeTask, needsAgent, selectNode } from './executors.js';\nimport { maybeAutoCompose } from './task-service.js';");
  fs.writeFileSync(p, s);
  console.log('import added');
} else console.log('already');
