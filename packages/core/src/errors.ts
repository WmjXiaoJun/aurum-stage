/**
 * 统一错误码字典（需求文档第二十一章）——前后端共用。
 * retry 字段描述调度层重试策略，uiHint 是前端可直接展示的可执行提示。
 */
export type RetryPolicy =
  | 'none'
  | 'reassign'          // 换号/换节点重试
  | 'cooling'           // 冷却后换号
  | 'cloud-retry'       // 云端超时 ≤2 次
  | 'degrade-once'      // 降级 1 次
  | 'recover';          // 任务回收重入队

export interface ErrorMeta {
  code: string;
  name: string;
  retry: RetryPolicy;
  maxAttempt: number;
  httpStatus: number;
  blocking: boolean;
  uiHint: string;
}

const M = (code: string, name: string, retry: RetryPolicy, maxAttempt: number, httpStatus: number, blocking: boolean, uiHint: string): ErrorMeta => ({
  code, name, retry, maxAttempt, httpStatus, blocking, uiHint
});

export const ERROR_CODES = {
  PARAM_INVALID: M('PARAM_INVALID', '参数校验失败（缺必填/参考图缺失）', 'none', 0, 400, true, '提示补全参数'),
  REF_MISSING: M('REF_MISSING', '参考图/参考音频文件不存在', 'none', 0, 422, true, '提示重新上传素材'),
  IDEMPOTENT_REPLAY: M('IDEMPOTENT_REPLAY', '重复提交（幂等命中旧任务）', 'none', 0, 409, false, '返回已有任务'),
  NOT_FOUND: M('NOT_FOUND', '资源不存在', 'none', 0, 404, true, '检查对象是否已删除'),
  PRIVACY_BLOCK: M('PRIVACY_BLOCK', '隐私镜头误选云端引擎', 'none', 0, 403, true, '涉敏镜头必须本地生成'),
  QUOTA_EXHAUSTED: M('QUOTA_EXHAUSTED', '云端账号额度耗尽', 'reassign', 3, 429, false, '云端额度不足，已切备用通道'),
  RATE_LIMITED: M('RATE_LIMITED', '云端限流 429', 'cooling', 3, 429, false, '排队中'),
  CLOUD_TIMEOUT: M('CLOUD_TIMEOUT', '云端任务超时丢失', 'cloud-retry', 2, 504, false, '自动重试'),
  OOM: M('OOM', 'GPU 显存不足', 'degrade-once', 1, 507, false, '自动降参数重试'),
  NODE_ERROR: M('NODE_ERROR', 'ComfyUI 节点报错', 'reassign', 1, 502, false, '显示节点报错摘要'),
  MODEL_MISSING: M('MODEL_MISSING', '模型文件缺失', 'none', 0, 503, false, '运维告警'),
  NODE_OFFLINE: M('NODE_OFFLINE', '节点心跳丢失', 'recover', 2, 503, false, '节点掉线，已转移'),
  TTS_TEXT_INVALID: M('TTS_TEXT_INVALID', '文本无法发音（生僻字/乱码）', 'none', 0, 422, true, '提示替换台词'),
  TTS_REF_POOR: M('TTS_REF_POOR', '参考音频质量差', 'none', 0, 422, true, '提示重录参考音频（≥6s、无背景噪）'),
  TTS_VOICE_CLONE_FAIL: M('TTS_VOICE_CLONE_FAIL', '音色克隆失败', 'none', 0, 422, true, '重录参考音频'),
  LIPSYNC_NO_FACE: M('LIPSYNC_NO_FACE', '未检测到人脸', 'none', 0, 200, false, '该镜头不做口型对齐'),
  LIPSYNC_BAD_QUALITY: M('LIPSYNC_BAD_QUALITY', '对齐后嘴部崩坏', 'none', 0, 200, false, '口型对齐失败，已保留原片'),
  COMPOSE_CONCAT_FAIL: M('COMPOSE_CONCAT_FAIL', '片段规格不一致拼接失败', 'degrade-once', 1, 500, false, '自动修复'),
  COMPOSE_SUBTITLE_FAIL: M('COMPOSE_SUBTITLE_FAIL', 'ASS 字幕语法错误', 'none', 0, 500, true, '检查字幕模板'),
  COMPOSE_NO_FFMPEG: M('COMPOSE_NO_FFMPEG', '未检测到 FFmpeg', 'none', 0, 501, false, '已输出字幕与剪辑清单，安装 FFmpeg 后可出片'),
  SEGMENT_DURATION_EXCEED: M('SEGMENT_DURATION_EXCEED', '段累计时长超过 300 秒硬上限', 'none', 0, 422, true, '删减镜头或拆分段落'),
  SEGMENT_CAP_NEAR: M('SEGMENT_CAP_NEAR', '段累计时长达到 280 秒预警线', 'none', 0, 200, false, '接近 5 分钟上限，请注意剩余时长'),
  SEGMENT_EMPTY: M('SEGMENT_EMPTY', '段内没有可渲染镜头', 'none', 0, 422, true, '先补充台词或拆分环节'),
  SCRIPT_PARSE_FAIL: M('SCRIPT_PARSE_FAIL', '台本解析失败', 'none', 0, 422, true, '检查台本标记是否闭合'),
  LLM_UNAVAILABLE: M('LLM_UNAVAILABLE', '文本后端不可用', 'reassign', 2, 503, false, '已切换备用供应商或本地推理'),
  LLM_SCHEMA_FAIL: M('LLM_SCHEMA_FAIL', '结构化输出校验失败', 'cloud-retry', 2, 502, false, '已用修复提示重生成'),
  AGENT_STAGE_LOCKED: M('AGENT_STAGE_LOCKED', '智能体阶段未确认', 'none', 0, 409, true, '先在智能体面板确认当前阶段'),
  FORBIDDEN: M('FORBIDDEN', '权限不足', 'none', 0, 403, true, '联系管理员授权'),
  INTERNAL: M('INTERNAL', '内部错误', 'none', 0, 500, true, '查看服务日志 trace_id')
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export function errorMeta(code: string): ErrorMeta {
  return (ERROR_CODES as Record<string, ErrorMeta>)[code] ?? ERROR_CODES.INTERNAL;
}
