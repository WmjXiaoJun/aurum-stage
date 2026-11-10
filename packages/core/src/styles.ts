/**
 * 第二十七章 · 多视觉风格体系
 * 风格（visual_style）与引擎（render_engine）正交：引擎决定在哪算，风格决定画成什么样。
 */
export const VISUAL_STYLES = ['photoreal', 'anime_2d', 'cgi_3d', 'comic'] as const;
export type VisualStyleId = (typeof VISUAL_STYLES)[number];

export interface VisualStylePreset {
  id: VisualStyleId;
  label: string;
  short: string;
  description: string;
  /** 风格前缀：固化媒介与画风关键词 */
  prefix: string;
  /** 风格负向约束 */
  negative: string;
  /** 风格参考图分析提示词（vision 用） */
  ref_analysis_prompt: string;
  /** 云端引擎模型建议 */
  muse_model: string;
  /** 本地工作流模板 key */
  comfy_template_key: string;
  /** 引擎参数默认值 */
  engine_params: Record<string, Record<string, unknown>>;
  /** 是否支持漫画面板/宫格 */
  supports_panels: boolean;
  /** 前端风格色（仅用于风格徽标，不替代引擎标识色） */
  accent: string;
  /** 适用微综艺 */
  fit: string[];
}

export const STYLE_PRESETS: Record<VisualStyleId, VisualStylePreset> = {
  photoreal: {
    id: 'photoreal',
    label: '写实真人',
    short: '写实',
    description: '真实人物、真实光影与材质，电影级镜头语言，访谈/脱口秀默认风格。',
    prefix: '电影级写实摄影, 真实人物皮肤质感, 35mm 定焦, 浅景深, 柔和棚灯, 自然肤色, 高动态范围',
    negative: '卡通, 插画, 扁平色块, 赛璐璐, 3D 渲染感, 塑料皮肤, 过度磨皮, 畸形手指, 扭曲人脸, 多余肢体, 双头, 文字水印',
    ref_analysis_prompt: '分析这张人物参考图的肤色、脸型、发型、服装与光线特征，输出可用于一致性约束的英文提示词片段',
    muse_model: 'muse-video-ext',
    comfy_template_key: 'h3_talk_closeup',
    engine_params: {
      muse_api: { model: 'muse-video-ext', resolution: '720p', aspect_ratio: '16:9' },
      comfy_h3: { motion_bucket: 42, fps: 25, guide_scale: 6.5, steps: 28, ipadapter_weight: 0.75 }
    },
    supports_panels: false,
    accent: '#D4B87E',
    fit: ['访谈类', '脱口秀类', '情景小剧场']
  },
  anime_2d: {
    id: 'anime_2d',
    label: '2D 动画',
    short: '2D',
    description: '平面赛璐璐与扁平插画，线条明确，适合知识科普与卡通主持。',
    prefix: '日式 2D 赛璐璐动画, 清晰描线, 平涂上色, 干净的阴影分界, 有限动画风格, 角色设计稿质感',
    negative: '写实照片, 真实皮肤纹理, 3D 渲染, 体积光, 油画笔触, 畸形手指, 扭曲人脸, 文字水印',
    ref_analysis_prompt: '分析这张 2D 风格参考图的线条粗细、上色方式、阴影层次与色调，输出风格约束片段',
    muse_model: 'muse-video-ext',
    comfy_template_key: 'sd_anime_2d',
    engine_params: {
      muse_api: { model: 'muse-video-ext', resolution: '720p', aspect_ratio: '16:9' },
      comfy_h3: { motion_bucket: 28, fps: 24, guide_scale: 7.5, steps: 30, ipadapter_weight: 0.7 }
    },
    supports_panels: true,
    accent: '#46A09B',
    fit: ['知识科普', '轻松短剧', '卡通主持']
  },
  cgi_3d: {
    id: 'cgi_3d',
    label: '3D 动画',
    short: '3D',
    description: '三维质感、立体布光与材质渲染，适合闯关综艺与虚拟主持人。',
    prefix: '三维动画渲染, 立体布光, PBR 材质, 次表面散射皮肤, 全局光照, 电影级景深, 卡通比例角色',
    negative: '真实照片, 2D 平涂, 手绘线条, 低模, 塑料感材质, 畸形手指, 扭曲人脸, 文字水印',
    ref_analysis_prompt: '分析这张 3D 风格参考图的渲染器风格、材质与光照设置，输出风格约束片段',
    muse_model: 'muse-video-ext',
    comfy_template_key: 'cgi_3d_render',
    engine_params: {
      muse_api: { model: 'muse-video-ext', resolution: '720p', aspect_ratio: '16:9' },
      comfy_h3: { motion_bucket: 36, fps: 25, guide_scale: 7.0, steps: 32, ipadapter_weight: 0.65 }
    },
    supports_panels: true,
    accent: '#8C7CF0',
    fit: ['闯关类', '游戏综艺', '虚拟主持人']
  },
  comic: {
    id: 'comic',
    label: '漫画 / 漫剧',
    short: '漫画',
    description: '漫画分镜、网点描线，支持 webtoon 条漫与宫格动态漫。',
    prefix: '黑白漫画分镜, 网点纸纹理, 粗细变化的描线, 戏剧性构图, 动感线, 高对比阴影',
    negative: '写实照片, 3D 渲染, 平涂动画, 柔和渐变, 畸形手指, 扭曲人脸, 文字水印',
    ref_analysis_prompt: '分析这张漫画参考图的分镜节奏、网点密度、描线风格与气泡排版，输出风格约束片段',
    muse_model: 'muse-video-ext',
    comfy_template_key: 'comic_panel_lineart',
    engine_params: {
      muse_api: { model: 'muse-video-ext', resolution: '720p', aspect_ratio: '16:9' },
      comfy_h3: { motion_bucket: 24, fps: 24, guide_scale: 8.0, steps: 26, ipadapter_weight: 0.8 }
    },
    supports_panels: true,
    accent: '#E8D6A8',
    fit: ['漫画化脱口秀', '剧情漫剧', '解说']
  }
};

export const STYLE_LIST: VisualStylePreset[] = VISUAL_STYLES.map((id) => STYLE_PRESETS[id]);

export function stylePreset(id: string | null | undefined): VisualStylePreset {
  return STYLE_PRESETS[(id as VisualStyleId) ?? 'photoreal'] ?? STYLE_PRESETS.photoreal;
}

/** 分镜提示词组装：风格前缀 + 画面内容 + 角色/场景锚定 + 镜头语言 + 负向约束 */
export function composePrompt(parts: {
  style?: string | null;
  content?: string | null;
  anchor?: string | null;
  camera_language?: string | null;
  styleId?: string | null;
}): string {
  const preset = stylePreset(parts.styleId);
  const chunks = [preset.prefix, parts.content, parts.anchor, parts.camera_language, parts.style]
    .map((s) => (s ?? '').trim())
    .filter(Boolean);
  return chunks.join(', ');
}
