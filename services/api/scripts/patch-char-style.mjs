import fs from 'node:fs';
const p = "D:\\BaiduSyncdisk\\wmj_work\\XJ\\AIweizongyi\\aurum-stage\\services\\api\\src\\adapters\\character-art.ts";
let s = fs.readFileSync(p, 'utf8');
if (!s.includes('STYLE_PROMPT')) {
  s = s.replace("interface ViewSpec", "const STYLE_PROMPT: Record<string, string> = {\n  photoreal: 'realistic portrait photograph, natural skin texture, soft key light, 85mm lens',\n  anime_2d: '2d anime character, cel shading, clean lineart, flat colors, anime key visual',\n  cgi_3d: 'stylized 3d cartoon character, pixar style animation, smooth stylized skin, big expressive eyes, non-photorealistic, 3d render',\n  comic: 'comic book character, bold ink outlines, halftone shading, graphic novel style'\n};\n\ninterface ViewSpec");
  s = s.replace("      const prompt = [character.prompt_prefix, character.persona, anchorPrompt, view.prompt, input.extra_prompt ?? ''].filter(Boolean).join(', ');",
    "      const prompt = [STYLE_PROMPT[style] ?? '', character.prompt_prefix, character.persona, anchorPrompt, view.prompt, 'no text, no logo, no badge, clean plain background', input.extra_prompt ?? ''].filter(Boolean).join(', ');");
  fs.writeFileSync(p, s);
  console.log('style prompt added');
} else console.log('already');
