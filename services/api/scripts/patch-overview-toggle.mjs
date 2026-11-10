import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\web\\src\\pages\\Overview.tsx";
let s = fs.readFileSync(p, 'utf8');
s = s.replace(/import \{([^}]*)\} from '\.\.\/components\/ui';/, (m, names) => names.includes('Toggle') ? m : "import {" + names + ", Toggle } from '../components/ui';");
fs.writeFileSync(p, s);
console.log('toggle imported');
