import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\domain\\development-pack.ts";
let s = fs.readFileSync(p, 'utf8');
if (!s.includes('attempt')) {
  s = s.replace("  for (const step of STEPS) {\n    const res = await runSkill(projectId, step.key, brief);\n    docs[step.key] = res.body as Record<string, unknown>;\n    steps.push({ key: step.key, name: step.name, status: res.status as PackStep['status'], gates: res.gates });\n    if (res.status !== 'passed') {\n      return { ok: false, stopped_at: step.name, steps };\n    }\n  }",
`  for (const step of STEPS) {
    let res = await runSkill(projectId, step.key, brief);
    // 未过门时带反馈重试一次，提高全自动成功率
    if (res.status !== 'passed') {
      const feedback = brief + '\\n\\n上一次未过质量门，请按以下问题修正后重出：\\n' + res.gates.filter((g) => !g.pass).map((g) => '- ' + g.label + '：' + g.detail).join('\\n');
      res = await runSkill(projectId, step.key, feedback);
    }
    docs[step.key] = res.body as Record<string, unknown>;
    steps.push({ key: step.key, name: step.name, status: res.status as PackStep['status'], gates: res.gates });
    if (res.status !== 'passed') {
      return { ok: false, stopped_at: step.name, steps };
    }
  }`);
  fs.writeFileSync(p, s);
  console.log('retry added');
} else console.log('already');
