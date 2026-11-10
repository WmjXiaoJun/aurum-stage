# 统一错误码字典 · 玄枢・AURUM

> 唯一来源：`packages/core/src/errors.ts` 的 `ERROR_CODES`（前后端共用，共 **29** 个码）。
> 服务端由 `services/api/src/http/errors.ts` 的 `ApiError` 抛出，调度层用 `errorMeta(code).retry` 决定重试；
> 前端用 `ui_hint` 直接给用户可执行提示。**新增错误码必须同时改 `packages/core/src/errors.ts` 与本文。**

## 0. 响应信封与字段语义

```json
{
  "ok": false,
  "error": {
    "code": "SEGMENT_DURATION_EXCEED",
    "message": "本段《第一轮 · AI 到底省了什么》已达 312 秒，超出上限 12 秒，请删减镜头或拆分段落",
    "ui_hint": "删减镜头或拆分段落",
    "retry": "none",
    "details": { "segment_id": 3, "title": "第一轮 · AI 到底省了什么", "duration_sec": 312, "exceed_sec": 12, "split_hint": "建议在第 6 与第 7 个镜头之间拆分（前段约 295 秒）" }
  }
}
```

| 字段 | 含义 |
| --- | --- |
| `code` | 稳定错误码（大小写敏感，前端按它分支，不按 message 匹配） |
| `message` | 面向开发者的具体描述，可能含 id/时长等上下文 |
| `ui_hint` | **面向用户的一句话行动建议**，可直接放进 toast/空态 |
| `retry` | 调度重试策略（见下表），前端可据此决定是否给「重试」按钮 |
| `details` | 结构化上下文（段 id、超出秒数、拆分建议、校验 issues 等） |

### retry 策略取值

| 取值 | 含义 | 调度行为 |
| --- | --- | --- |
| `none` | 不可自动重试 | 直接置 `failed`，必须人工修数据后重提 |
| `reassign` | 换账号 / 换节点 | `attempt+1` 回 `pending`、清空 `node_id`、重新选点或换云端账号 |
| `cooling` | 冷却后换号 | 同上，但受账号 `cooldown_until` 限制 |
| `cloud-retry` | 云端超时重试 | 最多 2 次 |
| `degrade-once` | 降级重试一次 | 置 `engine_params.degraded=1`（降参 / 降规格）后重试 1 次 |
| `recover` | 回收重入队 | 看门狗把节点上在跑任务收回 `pending` 重派 |

> `blocking=true` 表示该错误会**挡住当前操作的前进路径**（必须用户处理），`false` 表示系统已自动兜底、UI 只需要提示。

---

## 1. 通用 / 参数 / 权限

| code | 含义 | HTTP | retry | max_attempt | blocking | 前端提示（ui_hint） |
| --- | --- | --- | --- | --- | --- | --- |
| `PARAM_INVALID` | 参数校验失败（缺必填 / 参考图缺失 / Zod 校验不过） | 400 | none | 0 | ✅ | 提示补全参数 |
| `REF_MISSING` | 参考图 / 参考音频文件不存在 | 422 | none | 0 | ✅ | 提示重新上传素材 |
| `IDEMPOTENT_REPLAY` | 重复提交，幂等命中旧任务 | 409 | none | 0 | ❌ | 返回已有任务 |
| `NOT_FOUND` | 资源不存在（项目/镜头/任务/素材/模板/音色） | 404 | none | 0 | ✅ | 检查对象是否已删除 |
| `PRIVACY_BLOCK` | 隐私镜头误选云端引擎 | 403 | none | 0 | ✅ | 涉敏镜头必须本地生成 |
| `FORBIDDEN` | 权限不足 | 403 | none | 0 | ✅ | 联系管理员授权 |
| `INTERNAL` | 内部错误（未捕获异常兜底） | 500 | none | 0 | ✅ | 查看服务日志 trace_id |

## 2. 云端渲染通道（Muse Video）

| code | 含义 | HTTP | retry | max_attempt | blocking | 前端提示（ui_hint） |
| --- | --- | --- | --- | --- | --- | --- |
| `QUOTA_EXHAUSTED` | 云端账号额度耗尽 | 429 | reassign | 3 | ❌ | 云端额度不足，已切备用通道 |
| `RATE_LIMITED` | 云端限流 429 | 429 | cooling | 3 | ❌ | 排队中 |
| `CLOUD_TIMEOUT` | 云端任务超时丢失 | 504 | cloud-retry | 2 | ❌ | 自动重试 |

## 3. 本地 GPU 节点（ComfyUI · H3 / MuseTalk）

| code | 含义 | HTTP | retry | max_attempt | blocking | 前端提示（ui_hint） |
| --- | --- | --- | --- | --- | --- | --- |
| `OOM` | GPU 显存不足 | 507 | degrade-once | 1 | ❌ | 自动降参数重试 |
| `NODE_ERROR` | ComfyUI 节点报错 | 502 | reassign | 1 | ❌ | 显示节点报错摘要 |
| `MODEL_MISSING` | 模型文件缺失 | 503 | none | 0 | ❌ | 运维告警 |
| `NODE_OFFLINE` | 节点心跳丢失（>30s） | 503 | recover | 2 | ❌ | 节点掉线，已转移 |

## 4. 配音 TTS（IndexTTS-2）

| code | 含义 | HTTP | retry | max_attempt | blocking | 前端提示（ui_hint） |
| --- | --- | --- | --- | --- | --- | --- |
| `TTS_TEXT_INVALID` | 文本无法发音（生僻字 / 乱码） | 422 | none | 0 | ✅ | 提示替换台词 |
| `TTS_REF_POOR` | 参考音频质量差 | 422 | none | 0 | ✅ | 提示重录参考音频（≥6s、无背景噪） |
| `TTS_VOICE_CLONE_FAIL` | 音色克隆失败 | 422 | none | 0 | ✅ | 重录参考音频 |

## 5. 口型对齐 lip-sync（MuseTalk）

| code | 含义 | HTTP | retry | max_attempt | blocking | 前端提示（ui_hint） |
| --- | --- | --- | --- | --- | --- | --- |
| `LIPSYNC_NO_FACE` | 未检测到人脸 | 200 | none | 0 | ❌ | 该镜头不做口型对齐 |
| `LIPSYNC_BAD_QUALITY` | 对齐后嘴部崩坏 | 200 | none | 0 | ❌ | 口型对齐失败，已保留原片 |

> 这两个码刻意是 `HTTP 200 + blocking=false`：口型对齐是**尽力而为**的能力，失败不阻断出片，产物仍是可用原片。

## 6. 合成导出 compose（FFmpeg）

| code | 含义 | HTTP | retry | max_attempt | blocking | 前端提示（ui_hint） |
| --- | --- | --- | --- | --- | --- | --- |
| `COMPOSE_CONCAT_FAIL` | 片段规格不一致拼接失败 | 500 | degrade-once | 1 | ❌ | 自动修复 |
| `COMPOSE_SUBTITLE_FAIL` | ASS 字幕语法错误 | 500 | none | 0 | ✅ | 检查字幕模板 |
| `COMPOSE_NO_FFMPEG` | 未检测到 FFmpeg | 501 | none | 0 | ❌ | 已输出字幕与剪辑清单，安装 FFmpeg 后可出片 |

## 7. 段时长硬约束（300 秒）

| code | 含义 | HTTP | retry | max_attempt | blocking | 前端提示（ui_hint） |
| --- | --- | --- | --- | --- | --- | --- |
| `SEGMENT_DURATION_EXCEED` | 段累计时长超过 300 秒硬上限 | 422 | none | 0 | ✅ | 删减镜头或拆分段落 |
| `SEGMENT_CAP_NEAR` | 段累计时长达到 280 秒预警线 | 200 | none | 0 | ❌ | 接近 5 分钟上限，请注意剩余时长 |
| `SEGMENT_EMPTY` | 段内没有可渲染镜头 | 422 | none | 0 | ✅ | 先补充台词或拆分环节 |

> `SEGMENT_DURATION_EXCEED` 的 `details` 一定带 `{segment_id,title,duration_sec,exceed_sec,split_hint}`；
> 前端应把 `split_hint` 原样展示，它是用镜头边界算出来的**可执行**拆分建议。

## 8. 台本解析与文本模型

| code | 含义 | HTTP | retry | max_attempt | blocking | 前端提示（ui_hint） |
| --- | --- | --- | --- | --- | --- | --- |
| `SCRIPT_PARSE_FAIL` | 台本解析失败 | 422 | none | 0 | ✅ | 检查台本标记是否闭合 |
| `LLM_UNAVAILABLE` | 文本后端不可用 | 503 | reassign | 2 | ❌ | 已切换备用供应商或本地推理 |
| `LLM_SCHEMA_FAIL` | 结构化输出校验失败 | 502 | cloud-retry | 2 | ❌ | 已用修复提示重生成 |

## 9. 智能体流水线

| code | 含义 | HTTP | retry | max_attempt | blocking | 前端提示（ui_hint） |
| --- | --- | --- | --- | --- | --- | --- |
| `AGENT_STAGE_LOCKED` | 智能体阶段未确认 | 409 | none | 0 | ✅ | 先在智能体面板确认当前阶段 |

---

## 10. 前端处理约定

| 判定依据 | UI 行为 |
| --- | --- |
| `retry === 'none' && blocking === true` | 红色阻断提示 + 定位到出问题的对象（镜头/环节/素材）；不显示「重试」 |
| `retry !== 'none'`（自动兜底） | 黄色信息条 + 「系统正在自动重试」；不打断当前操作 |
| `blocking === false`（如 LIPSYNC_*） | 只做角标/行内提示，功能继续可用 |
| `IDEMPOTENT_REPLAY` | 视为成功：直接使用返回的已有任务，不提示错误 |
| `INTERNAL` | 显示「操作失败，已记录」+ 复制 trace_id；同时上报前端埋点 |

**「重试」按钮的启用规则**：`retry === 'none'` 时只允许「重提任务」（`POST /shots/:id/render`）而不是任务级 `retry`；
任务级重试（`POST /tasks/:id/retry`）仅对 `failed/blocked/canceled` 且有上游成功产物的任务有效，`running/assigned` 会直接返回 400。

---

## 11. 与服务端行为的对应

| 场景 | 服务端落点 | 返回 |
| --- | --- | --- |
| 段超 300s 提交渲染 | `assertSegmentCompliance`（`POST /shots/:id/render`、`/projects/:id/render-all`） | 422 `SEGMENT_DURATION_EXCEED`，**不建任务、不计费** |
| 隐私镜头选云端 | `submitShotRender` | 403 `PRIVACY_BLOCK` |
| 任务重试耗尽 | `scheduler.runOne` 的 `retryDecision` | 任务 `failed` + 广播 `task.failed`，`round_shot.error_code` 同步写码 |
| 节点掉线 | `scheduler.watchdog` | 广播 `node.offline` + 任务回收（`error_code=NODE_OFFLINE`） |
| 上游失败阻断下游 | `scheduler.dispatchPending` | 下游 `blocked`，`error_msg="上游任务失败（id…）"` |
| 合成无 FFmpeg | `adapters/compose.ts` | `mode=manifest` + `warnings[]`（`COMPOSE_NO_FFMPEG` 语义） |

> 注：`COMPOSE_NO_FFMPEG` 在当前实现里以 `warnings` 文本 + `mode='manifest'` 呈现（`POST /projects/:id/compose` 返回 200），
> 仅当合成作为排队任务执行时才以错误码形式进 `render_task.error_code`。
