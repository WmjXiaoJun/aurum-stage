import { generatePlanArt } from '../src/adapters/asset-art.ts';
const r = await generatePlanArt(40, [
  { kind: 'scene', name: 'main stage', prompt: 'futuristic 3d variety show stage with neon rings and holographic screens, wide shot, cinematic lighting' },
  { kind: 'scene', name: 'backstage', prompt: 'backstage corridor with warm practical lights, camera rigs, cinematic' }
], 2);
console.log(JSON.stringify(r));
process.exit(0);
