import fs from 'node:fs';
const html = fs.readFileSync('D:/BaiduSyncdisk/wmj_work/XJ/AIweizongyi/aurum-stage/shots/dom.html', 'utf8');
const main = html.slice(html.indexOf('<main'), html.indexOf('</main>') + 7);
console.log('main length', main.length);
console.log(main.slice(0, 1200));
console.log('has 角色库', html.includes('角色库'), 'has skeleton', html.toLowerCase().includes('skeleton'));
