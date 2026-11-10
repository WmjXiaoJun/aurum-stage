/** 电影感 H3 提示词：对齐 AiJue cinema3d 的四段式（风格/主体/环境/角色/运镜/声音） */
const STYLE: Record<string, string> = {
  photoreal: 'High-end cinematic film still from a late-night talk show, shot on 35mm, shallow depth of field, volumetric haze, warm amber practicals against cool teal background, filmic color grade, 16:9 widescreen',
  anime_2d: 'High-end 2D animated talk-show frame, cel shading, clean lineart, rich background painting, cinematic composition, warm amber against cool teal, 16:9 widescreen',
  cgi_3d: 'High-end 3D animated feature film shot, stylized characters, physically based materials, volumetric light, shallow depth of field, warm amber and mineral teal grading, 16:9 widescreen',
  comic: 'Graphic novel talk-show frame, bold ink outlines, halftone shading, dramatic rim light, warm amber and teal palette, 16:9 widescreen'
};

const ENV = 'a late-night talk-show studio: a glossy dark walnut desk in the foreground, a deep red velvet guest chair, warm practical lamps with brass shades, a blurred neon city skyline cyclorama behind, drifting haze, dark navy walls';

const CHARS: Record<string, string> = {
  '老周': 'the host: a 52-year-old Chinese man, short black hair with grey at the temples, thin rectangular glasses, dark navy suit with a white shirt and no tie, calm and dry-humoured',
  '苏晚': 'the guest: a 28-year-old Chinese woman, shoulder-length black hair, black silk shirt, silver rings, sharp and composed expression'
};

const NEG = 'no text, no subtitles, no captions, no signage lettering, no watermark, no logo, no UI, no extra people unless described, no distorted anatomy, no deformed faces';

const ACTIONS = [
  'rests one forearm on the desk and leans slightly toward the guest while speaking, then settles back',
  'turns toward the guest with a small nod, one hand lifting in a light gesture',
  'laughs quietly, shoulders relaxing, glancing down then back up',
  'leans back in the chair and gestures open-palmed toward the guest, inviting a reply',
  'listens without moving, eyes steady on the other person, fingers tapping once on the desk',
  'shifts forward, elbows on knees, speaking with quiet intensity'
];

export function buildCinematicPrompt(input: { speaker: string; camera: string; style: string; index: number; emotion?: string }): string {
  const style = STYLE[input.style] ?? STYLE.photoreal;
  const action = ACTIONS[Math.abs(input.index) % ACTIONS.length];
  const who = CHARS[input.speaker] ?? CHARS['老周'];
  const camera = input.camera === 'wide'
    ? 'slow steady wide two-shot, camera easing sideways'
    : input.camera === 'medium_shot'
      ? 'medium two-shot at eye level, slow dolly-in'
      : 'intimate close-up, very slow push-in, shallow focus on the eyes';
  return 'integrated_multimodal_description: [Shot 1] ' + style + '. ' + who + ' ' + action + '. Environment: ' + ENV + '. ' + (input.speaker === '苏晚' ? CHARS['老周'] + ' sits opposite, soft focus.' : CHARS['苏晚'] + ' sits opposite, soft focus.') + ' Camera: ' + camera + '. The motion is natural, cinematic and continuous, with rich physical materials, volumetric light and shallow depth of field. ' + NEG + '.\n\noverall_soundscape: quiet studio room tone, faint city hum through glass, soft fabric movement. No dialogue, no human voices, no music.\n\nnon_diegetic_music: N/A';
}
