# REST API 与实时事件 · 玄枢・AURUM

> 所有接口前缀 **`/api/v1`**，由 `services/api/src/routes/{index,meta,projects,scripts,shots,assets,characters,voices,templates,tasks,nodes,agents,llm,styles,ws}.ts` 注册。
> 生产经 nginx 反代：`http://<host>:8080/api/v1/...`；内网直连：`http://<host>:8787/api/v1/...`。

**通用约定**

- 请求/响应均为 JSON（文件上传与 `/assets/:id/raw` 例外）。`POST /projects/:id/assets` 支持 `application/octet-stream` 二进制体或 base64 JSON。
- 成功：直接返回资源对象或数组；创建类接口返回 **201**。
- 失败：统一信封（`services/api/src/http/errors.ts`）：
  ```json
  { "ok": false, "error": { "code": "SEGMENT_DURATION_EXCEED", "message": "本段《第一轮》已达 312 秒…", "ui_hint": "删减镜头或拆分段落", "retry": "none", "details": { "segment_id": 3, "exceed_sec": 12 } } }
  ```
  错误码全表见 [ERROR_CODES.md](./ERROR_CODES.md)。
- 鉴权：业务接口无鉴权（内网/VPN 内使用）；**Agent 内部接口**（`/agent/**`）必须带请求头 `x-agent-token: $AGENT_TOKEN`。
- 幂等：渲染/配音类提交按 `idempotency_key = sha256(镜头|文本|情绪|语速|引擎|nonce)` 去重，重复提交返回已有任务（`IDEMPOTENT_REPLAY`）；`force: true` 会带时间戳破幂等。
- 分页：列表接口用固定上限（`/tasks` 默认 200，可用 `limit` 调整；`/projects/:id/assets` 固定 200 条倒序）。

---

## 1. 元信息（meta）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查：服务名、版本、时间戳、ffmpeg 路径、数据库文件 |
| GET | `/meta` | 全量元数据：产品信息、业务常量（300s/280s 等）、引擎/机位/环节/任务/轨道枚举、风格与情绪、错误码字典、标签速查、运行时开关 |
| GET | `/runtime` | 精简运行时视图：ffmpeg、segment_cap_sec、调度器配置、TTS Worker、模拟开关 |
| GET | `/stats/overview` | 统计占位接口（当前返回 `{ok:true}`，保留给看板聚合） |

```bash
curl -s http://127.0.0.1:8787/api/v1/health
curl -s http://127.0.0.1:8787/api/v1/meta | python -m json.tool | head -40
```

---

## 2. 项目 projects

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/projects` | 项目列表（附 `segment_count`/`shot_count`/`duration_ms`） |
| POST | `/projects` | 创建项目（201） |
| GET | `/projects/:id` | 项目详情 |
| PATCH | `/projects/:id` | 局部更新，并重建派生数据（段时长/时间轴） |
| DELETE | `/projects/:id` | 删除项目（级联删除环节、镜头、台本） |
| GET | `/projects/:id/overview` | 驾驶舱聚合：项目+环节+镜头+合规+统计+质检问题+最近导出+最新台本 |
| GET | `/projects/:id/compliance` | 段时长合规明细（cap_sec + 每段 duration/status/split_suggestion） |
| GET | `/projects/:id/segments` | 环节列表 |
| POST | `/projects/:id/segments` | 新增环节（201，seq 自动递增） |
| PATCH | `/segments/:segmentId` | 更新环节（title/segment_type/default_engine/visual_style） |
| DELETE | `/segments/:segmentId` | 删除环节并重建派生数据 |
| GET | `/projects/:id/timeline` | 时间轴条目 |
| POST | `/projects/:id/timeline` | 新增时间轴条目（201） |
| PATCH | `/timeline/:itemId` | 更新时间轴条目 |
| DELETE | `/timeline/:itemId` | 删除时间轴条目 |
| POST | `/projects/:id/compose` | 合成导出（同步执行，返回 mp4 或 manifest 清单） |
| GET | `/projects/:id/exports` | 导出记录列表 |
| GET | `/projects/:id/issues` | 质检问题（`?resolved=all` 含已处理） |
| PATCH | `/issues/:issueId` | 标记问题已处理/未处理 |
| GET | `/projects/:id/clues` | 一致性线索列表 |
| POST | `/projects/:id/clues` | 新增/覆盖线索（201） |
| DELETE | `/clues/:clueId` | 删除线索 |
| GET | `/projects/:id/tasks` | 项目下任务（最多 200） |
| GET | `/projects/:id/assets` | 项目素材（`?type=video` 过滤，附 `url`） |

```bash
curl -s -X POST http://127.0.0.1:8787/api/v1/projects \
  -H 'Content-Type: application/json' \
  -d '{"name":"AI 微综艺 · 创业者的第 101 次复盘","variety_type":"talk_show","visual_style":"photoreal","aspect_ratio":"9:16","fps":25,"privacy_mode":false}'

curl -s -X POST http://127.0.0.1:8787/api/v1/projects/1/segments \
  -H 'Content-Type: application/json' \
  -d '{"title":"第一轮 · AI 到底省了什么","segment_type":"talk_round","default_engine":"comfy_h3"}'

curl -s -X POST http://127.0.0.1:8787/api/v1/projects/1/timeline \
  -H 'Content-Type: application/json' \
  -d '{"track":"flower","start_ms":1200,"end_ms":3200,"payload":{"type":"title_card","text":"这一期，我们聊点真话"}}'

curl -s -X POST http://127.0.0.1:8787/api/v1/projects/1/compose \
  -H 'Content-Type: application/json' \
  -d '{"segment_id":1,"bgm":true}'
```

`compose` 返回：

```json
{ "mode": "mp4 | manifest", "duration_sec": 137.4,
  "video_url": "/api/v1/assets/128/raw", "subtitle_url": "/api/v1/assets/129/raw",
  "ass_url": "/api/v1/assets/130/raw", "warnings": [], "manifest": { "total_ms": 137400, "shots": [] } }
```

---

## 3. 台本 scripts

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/projects/:id/scripts` | 台本版本列表 |
| POST | `/projects/:id/scripts` | 上传台本原文（Markdown），201 |
| GET | `/projects/:id/script/latest` | 取最新版本台本（无则 404） |
| GET | `/scripts/:scriptId` | 台本详情 + 镜头列表 + 合规 |
| GET | `/scripts/:scriptId/export.md` | 导出为 Markdown（结构化优先，回退原文） |
| POST | `/scripts/:scriptId/parse` | 解析落库：规则解析，镜头数 <3 且配置了 LLM 时自动降级结构化兜底 |
| POST | `/projects/:id/parse-preview` | 试解析，不落库（返回结构化结果 + 每段预估时长） |

```bash
curl -s -X POST http://127.0.0.1:8787/api/v1/projects/1/scripts \
  -H 'Content-Type: application/json' \
  -d '{"raw_md":"# AI 圆桌派 第 1 期\n\n## 第一轮 · AI 到底省了什么\n【主持人·阿哲】欢迎来到 AI 圆桌派。\n【嘉宾·林小满】能替掉的是体力活，替不掉的是判断。"}'

curl -s -X POST http://127.0.0.1:8787/api/v1/scripts/1/parse \
  -H 'Content-Type: application/json' \
  -d '{"use_llm":true}'
```

`parse` 返回：`{ script, report:{segments,shots,used_llm,source,warnings,errors}, compliance:[…], created_characters:[…], shots:[…] }`。

---

## 4. 镜头 shots

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/projects/:id/shots` | 项目镜头（`?segment_id=&status=&engine=&search=`） |
| GET | `/segments/:segmentId/shots` | 某环节下的镜头 |
| GET | `/shots/:shotId` | 镜头详情 + 任务 DAG + 项目 + 音频/视频候选 |
| POST | `/segments/:segmentId/shots` | 新增镜头（201，shot_code 自动生成） |
| PATCH | `/shots/:shotId` | 修改镜头（台词/情绪/机位/引擎/隐私/锁定…），并重算时长 |
| DELETE | `/shots/:shotId` | 删除镜头 |
| POST | `/segments/:segmentId/reorder` | 按 `ordered_ids` 重排镜头 |
| POST | `/shots/:shotId/render` | **提交渲染**：300s 硬校验后建立 tts→video→lipsync DAG |
| POST | `/shots/:shotId/tts` | 只重配这一句台词（不建视频任务，秒级可听） |
| GET | `/shots/:shotId/audio` | 该镜头的 TTS 候选列表（idx/state/duration/url） |
| GET | `/shots/:shotId/tasks` | 该镜头全部任务 |
| POST | `/shots/:shotId/lock` | 锁定/解锁镜头（`{"locked":true}`） |
| POST | `/shots/:shotId/candidates/:candidateId/select` | 选定候选（换音频会同步改写镜头时长） |
| POST | `/projects/:id/render-all` | 批量提交渲染（跳过 locked 镜头） |
| GET | `/projects/:id/shot-codes` | 项目内全部 `shot_code` |

```bash
curl -s -X POST http://127.0.0.1:8787/api/v1/segments/1/shots \
  -H 'Content-Type: application/json' \
  -d '{"lines":["能替掉的是体力活，替不掉的是判断。"],"speaker_role_id":"c_guest_lin","speaker_name":"林小满","camera":"close_up","emotion":"thoughtful","render_engine":"comfy_h3"}'

curl -s -X POST http://127.0.0.1:8787/api/v1/shots/12/render \
  -H 'Content-Type: application/json' \
  -d '{"candidates":3,"overrides":{"render_engine":"comfy_h3","tts_speed":1.02}}'

curl -s -X POST http://127.0.0.1:8787/api/v1/shots/12/tts \
  -H 'Content-Type: application/json' \
  -d '{"candidates":3,"overrides":{"emotion":"surprised","speed":1.05}}'

curl -s -X POST http://127.0.0.1:8787/api/v1/shots/12/candidates/34/select
```

`render` 返回：

```json
{ "shot_id": 12, "replays": [212],
  "task_dag": [ { "task_id": 211, "type": "tts", "status": "pending", "depends_on": [] },
                { "task_id": 212, "type": "comfy_h3", "status": "pending", "depends_on": [211] },
                { "task_id": 213, "type": "lipsync", "status": "pending", "depends_on": [211,212] } ] }
```

---

## 5. 素材 assets

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/assets/:id` | 素材元数据 |
| GET | `/assets/:id/raw` | 原始字节流（按扩展名定 MIME，`Cache-Control: max-age=60`；空文件 204） |
| POST | `/projects/:id/assets` | 上传素材（201，支持二进制体或 base64；query：`filename/type/source/duration`） |
| DELETE | `/assets/:id` | 删除素材（同时删对象） |
| GET | `/projects/:id/assets/list` | 素材列表（按 `?type=` 过滤） |

```bash
# 二进制直传
curl -s -X POST "http://127.0.0.1:8787/api/v1/projects/1/assets?filename=ref_host.wav&type=audio&source=upload" \
  -H 'Content-Type: application/octet-stream' --data-binary @ref_host.wav

# base64 上传
curl -s -X POST http://127.0.0.1:8787/api/v1/projects/1/assets \
  -H 'Content-Type: application/json' \
  -d '{"filename":"host.png","data_base64":"iVBORw0KGgo..."}'
```

> 中台 `bodyLimit` 为 128MB；网关 `client_max_body_size 512m` 只是不提前拦，超过 128MB 请走 MinIO 直传后登记 `object_key`。

---

## 6. 角色 characters

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/projects/:id/characters` | 项目角色（含参考图与音色） |
| GET | `/characters/:id` | 角色详情 |
| POST | `/projects/:id/characters` | 新建角色（201，`role_id` 可省，自动生成） |
| PATCH | `/characters/:id` | 更新角色（人设/前缀/种子/授权/启用） |
| DELETE | `/characters/:id` | 停用角色（`is_active=0`，不物理删除） |
| POST | `/characters/:id/ref-images` | 绑定参考图（201，`angle` 默认 front） |
| DELETE | `/characters/:id/ref-images/:refId` | 解绑参考图 |
| POST | `/characters/:id/version` | 升版本（换服装/造型），旧版本保留给历史镜头 |

```bash
curl -s -X POST http://127.0.0.1:8787/api/v1/projects/1/characters \
  -H 'Content-Type: application/json' \
  -d '{"name":"林小满","role_type":"guest","persona":"35 岁连续创业者，语速快，爱下结论","prompt_prefix":"中国女性，短发，米色西装","lock_seed":true,"seed":286331}'

curl -s -X POST http://127.0.0.1:8787/api/v1/characters/3/ref-images \
  -H 'Content-Type: application/json' -d '{"asset_id":41,"angle":"front","weight":1}'
```

---

## 7. 音色 voices

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/projects/:id/voices` | 项目音色（含参考音频） |
| POST | `/projects/:id/voices` | 新建/登记音色（201，`voice_id` 必填） |
| PATCH | `/voices/:id` | 更新音色（语速/情绪集合/禁用项/授权） |
| DELETE | `/voices/:id` | 删除音色 |
| POST | `/voices/:id/ref-audios` | 绑定参考音频（201） |
| DELETE | `/voices/:id/ref-audios/:refId` | 解绑参考音频 |
| GET | `/voices/:id/health` | 参考音频体检：≥2 条、6–15s、含 emotional_peak、授权有效期 |
| GET | `/emotions` | 情绪字典（EMOTION_MAP 全量） |

```bash
curl -s -X POST http://127.0.0.1:8787/api/v1/projects/1/voices \
  -H 'Content-Type: application/json' \
  -d '{"voice_id":"v_linxiaoman","role_id":"c_guest_lin","provider":"indextts2","base_speed":1.02,"available_emotions":["friendly_smile","thoughtful","surprised","serious"]}'

curl -s -X POST http://127.0.0.1:8787/api/v1/voices/1/ref-audios \
  -H 'Content-Type: application/json' -d '{"asset_id":42,"ref_type":"emotional_peak","duration_sec":8.4}'

curl -s http://127.0.0.1:8787/api/v1/voices/1/health
```

`health` 返回 `{ voice_id, refs, ok, issues:[…], authorization:{file_hash, valid_until} }`。

---

## 8. 工作流模板 templates

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/templates` | 模板列表（`?type=muse_api|comfy_workflow|tts_preset`） |
| GET | `/templates/:key` | 按 `template_key` 取模板 |
| POST | `/templates` | 新建/覆盖模板（201，`template_key`+`template_type` 必填） |
| PATCH | `/templates/:key` | 更新模板（body/param_map/schema/constraints/enabled） |
| DELETE | `/templates/:key` | 删除模板 |

```bash
curl -s -X POST http://127.0.0.1:8787/api/v1/templates \
  -H 'Content-Type: application/json' \
  -d '{"template_key":"h3_t2v_v1","template_type":"comfy_workflow","display_name":"H3 文生视频 v1","template_body":{"3":{"class_type":"KSampler","inputs":{}}},"param_map":{"prompt":"3.inputs.text"}}'
```

---

## 9. 任务与调度 tasks / scheduler

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/tasks` | 任务列表（`?project_id=&shot_id=&status=&task_type=&limit=`，默认 200） |
| GET | `/tasks/:id` | 任务详情 |
| POST | `/tasks/:id/retry` | 重试（`running/assigned` 状态拒绝，400） |
| POST | `/tasks/:id/cancel` | 取消（`success` 直接返回原任务） |
| GET | `/tasks/stats/:projectId` | 按类型/状态的计数 |
| GET | `/scheduler/stats` | 调度器实时视图：running 列表、pending 分组、按状态/类型计数 |
| POST | `/scheduler/tick` | 手动触发一次派发（调试用） |

```bash
curl -s "http://127.0.0.1:8787/api/v1/tasks?project_id=1&task_type=lipsync&limit=20"
curl -s -X POST http://127.0.0.1:8787/api/v1/tasks/211/retry
curl -s http://127.0.0.1:8787/api/v1/scheduler/stats
```

---

## 10. GPU 节点与 Agent 内部接口 nodes / agent

> `/agent/**` 全部要求请求头 `x-agent-token`（值 = `AGENT_TOKEN`），token 不符直接抛错。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/nodes` | 节点列表（`engine_tags`/`models_loaded` 已解析） |
| POST | `/nodes` | 手工登记节点（201，运维补录用） |
| DELETE | `/nodes/:nodeKey` | 删除节点 |
| GET | `/nodes/select` | 按 tag 试算选点结果（`?tag=h3|lipsync`） |
| POST | `/agent/register` | 节点注册（幂等 upsert，`node_key` 必填） |
| POST | `/agent/heartbeat` | 心跳：回写 vram/queue/tags/models，返回 `next_heartbeat_ms:10000` |
| GET | `/agent/tasks/pull` | **长轮询**拉任务（`?node=<key>&wait=30`）：有任务 200 + `workflow_json`，无任务 204 |
| POST | `/agent/tasks/:id/progress` | 上报进度（0–100） |
| POST | `/agent/tasks/:id/result` | 回传产物：`video_base64`/`duration_ms`/`external_id`/`meta` |
| POST | `/agent/tasks/:id/fail` | 回传失败：`error_code`/`error_msg`，任务回到 pending 且 attempt+1 |

```bash
TOKEN=change-me-aurum-agent-token; CENTER=http://127.0.0.1:8787/api/v1
curl -s -X POST "$CENTER/agent/register" -H "Content-Type: application/json" -H "x-agent-token: $TOKEN" \
  -d '{"node_key":"gpu-h3-01","base_url":"http://10.0.0.31:8188","engine_tags":["h3","lipsync"],"vram_total_gb":24,"models_loaded":["h3_t2v_v1"]}'

curl -s -X POST "$CENTER/agent/heartbeat" -H "Content-Type: application/json" -H "x-agent-token: $TOKEN" \
  -d '{"node_key":"gpu-h3-01","vram_free_gb":19.4,"queue_len":0}'

curl -s -i "$CENTER/agent/tasks/pull?node=gpu-h3-01&wait=30" -H "x-agent-token: $TOKEN"

curl -s -X POST "$CENTER/agent/tasks/212/result" -H "Content-Type: application/json" -H "x-agent-token: $TOKEN" \
  -d '{"duration_ms":5000,"external_id":"comfy-9f2c"}'
```

`pull` 命中时返回：

```json
{ "task_id": 212, "shot_id": 12, "task_type": "comfy_h3",
  "workflow_template": "h3_t2v_v1", "workflow_json": { "3": { "inputs": { "text": "…" } } },
  "param_map": { "prompt": "3.inputs.text" }, "params": { "prompt": "…", "target_duration_ms": 5300, "seed": 286331 } }
```

---

## 11. 智能体流水线 agents

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/agents/stages` | 六个阶段的定义（characters/outline/script/casting/storyboard/qa） |
| GET | `/projects/:id/agents/runs` | 项目下的智能体运行列表（含阶段行） |
| POST | `/projects/:id/agents/run` | 启动流水线（201，`source_text` 必填；`auto_run` 默认 true 异步跑完） |
| GET | `/agents/runs/:runId` | 运行详情：阶段、事件、质检问题 |
| POST | `/agents/runs/:runId/step` | 推进一步（`stage` 指定阶段，否则按序推进） |
| POST | `/agents/runs/:runId/run-all` | 一口气跑完 |
| POST | `/agents/runs/:runId/confirm` | 编导确认/打回（`approve`+`feedback`，`rerun` 打回后重跑） |
| POST | `/agents/runs/:runId/apply` | 把产物落入项目（写台本/环节/镜头） |
| GET | `/agents/runs/:runId/stream` | **SSE** 流：`run.snapshot` / `run.stage` / 事件回放 / `run.end`（最长 120s） |

```bash
curl -s -X POST http://127.0.0.1:8787/api/v1/projects/1/agents/run \
  -H 'Content-Type: application/json' \
  -d '{"source_text":"三个连续创业者聊为什么九成 AI 产品死在 Demo 阶段","source_kind":"idea","target_sec":180,"auto_run":true}'

curl -s -N http://127.0.0.1:8787/api/v1/agents/runs/1/stream
```

SSE 帧示例：

```
event: run.snapshot
data: {"run":{"id":1,"stage":"characters","status":"running"},"stages":[...]}

event: run.stage
data: {"stage":"script","status":"running"}
```

---

## 12. LLM 供应商 llm

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/llm/providers` | 供应商列表（密钥脱敏由服务层处理） |
| POST | `/llm/providers` | 新增/更新供应商（201，`provider_key`+`base_url` 必填） |
| PATCH | `/llm/providers/:id` | 修改供应商 |
| DELETE | `/llm/providers/:id` | 删除供应商（级联删模型） |
| POST | `/llm/providers/:id/discover` | 拉取模型列表（OpenAI 兼容 `/models`） |
| POST | `/llm/providers/:id/health` | 健康探测，写回 `health/last_check` |
| GET | `/llm/usage` | 用量汇总（`?days=7`） |
| GET | `/projects/:id/llm` | 项目可用供应商 + 当前覆盖 |
| PUT | `/projects/:id/llm` | 设置项目级覆盖（`provider_id`/`model_id`/`params`） |

```bash
curl -s -X POST http://127.0.0.1:8787/api/v1/llm/providers \
  -H 'Content-Type: application/json' \
  -d '{"provider_key":"deepseek","protocol":"openai","base_url":"https://api.deepseek.com/v1","api_keys":["sk-xxx"],"is_default":true}'

curl -s -X PUT http://127.0.0.1:8787/api/v1/projects/1/llm \
  -H 'Content-Type: application/json' \
  -d '{"provider_id":1,"model_id":"deepseek-chat","params":{"temperature":0.7}}'
```

---

## 13. 视觉风格与漫画面板 styles / comic

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/styles` | 风格预设全量 |
| GET | `/styles/:id` | 单个风格预设 |
| POST | `/styles/preview-prompt` | 试算提示词（正向 + 负向） |
| POST | `/projects/:id/style-ref` | 绑定风格参考图，写回项目 `style_prompt` |
| GET | `/comic/panels` | 漫画面板（`?project_id=` 必填） |
| POST | `/comic/panels` | 新增面板（201，`layout` 支持 grid_4/6/9） |
| PATCH | `/comic/panels/:id` | 更新面板 |
| DELETE | `/comic/panels/:id` | 删除面板 |
| GET | `/comic/webtoon` | webtoon 纵向长条视图（`?project_id=`） |

```bash
curl -s -X POST http://127.0.0.1:8787/api/v1/styles/preview-prompt \
  -H 'Content-Type: application/json' \
  -d '{"style_id":"photoreal","content":"赛博霓虹城市夜景推镜","camera_language":"缓推"}' | python -m json.tool

curl -s -X POST http://127.0.0.1:8787/api/v1/comic/panels \
  -H 'Content-Type: application/json' \
  -d '{"project_id":1,"layout":"grid_4","panel_json":{"caption":"第一轮 · 观点对撞"}}'
```

---

## 14. WebSocket 事件（`GET /api/v1/ws`）

连接：`ws://<host>:8080/api/v1/ws`（经 nginx，Upgrade 已透传）或直连 `ws://127.0.0.1:8787/api/v1/ws`。

**客户端订阅**：

```json
{ "type": "subscribe", "project_id": 1 }
```

- `project_id` 省略或 `null` = 订阅全部项目；
- 订阅后服务端会回一帧 `hello`；
- 服务端只把 `project_id` 相同的事件推给该连接（**事件缺 project_id 时全推**，例如 `node.offline`）。

**统一信封**（`services/api/src/ws/hub.ts`）：

```json
{ "type": "task.progress", "project_id": 1, "ts": 1730000000000, "payload": { "task_id": 212, "progress": 45 } }
```

### 事件表

| type | 触发位置 | payload 关键字段 | 前端处理建议 |
| --- | --- | --- | --- |
| `hello` | 连接建立 / 收到任意客户端消息 | `ok`, `ts` | 标记已连上，开始拉首屏 |
| `task.created` | `submitShotRender` / `submitShotTts` | `shot_id`, `tasks:[{id,type,status}]` | 镜头卡切「排队中」，占位进度条 |
| `task.progress` | 调度执行、节点上报、看门狗回收 | `task_id`, `task_type`, `shot_id`, `progress`(0-100), `status`, `note`, `retrying`, `error_code` | 进度条；`note` 直接当提示语（如「节点掉线，已转移」） |
| `task.preview` | TTS 出音频 / 视频出片 / 口型对齐出片 | `task_id`, `task_type`, `shot_id`, `audio_url` 或 `video_url`, `poster_url`, `duration_ms`, `candidates[]` | 立刻可播可试听，不等整条链完成 |
| `task.success` | 任务成功（本地执行 / 节点回传） | `task_id`, `task_type`, `shot_id`, `latency_ms`, `result`（节点侧为 `asset_id`, `agent:true`） | 刷新镜头与候选；节点侧耗时从这里算 |
| `task.failed` | 重试耗尽 / 上游阻断 / 节点回报失败 | `task_id`, `task_type`, `shot_id`, `error_code`, `message`, `ui_hint` | 展示 `ui_hint`；`message` 进详情抽屉；按 `ERROR_CODES.md` 决定是否给「重试」按钮 |
| `task.assigned` | 派发给 GPU 节点 | `task_id`, `node_id`, `node_key` | 节点维度的负载视图高亮 |
| `task.retry` | `POST /tasks/:id/retry` | `task_id` | 进度归零，回到排队 |
| `task.canceled` | `POST /tasks/:id/cancel` | `task_id` | 卡片置灰，解除 loading |
| `node.offline` | 看门狗（心跳 >30s） | `node_id`, `node_key`（**无 project_id，全员广播**） | 顶部节点条变红；在跑的镜头提示「已转移」 |
| `compose.progress` | 合成执行器 | `task_id`, `progress`（10 → 100） | 导出模态的进度条 |
| `compose.success` | 合成产出 mp4 | `task_id`, `video_url`, `duration_sec` | 直接给下载/播放按钮 |
| `agent.event` | 智能体流水线每次状态变化 | `run_id`, `type`（`run.started`/`stage.started`/`stage.done`/`stage.failed`/`stage.confirm`/`run.applied`）, `stage`, `agent`, `message`, `code` | 智能体面板的时间线；`stage.failed` 带 `code` 可映射错误码 |

```js
// 浏览器侧最小实现
const ws = new WebSocket('ws://127.0.0.1:8080/api/v1/ws');
ws.onopen = () => ws.send(JSON.stringify({ type: 'subscribe', project_id: 1 }));
ws.onmessage = (e) => {
  const ev = JSON.parse(e.data);
  switch (ev.type) {
    case 'task.progress': renderProgress(ev.payload); break;
    case 'task.preview':  playPreview(ev.payload);   break;
    case 'task.failed':   toast(ev.payload.ui_hint ?? ev.payload.message); break;
    default: console.debug(ev);
  }
};
```

> 断线重连：`hub` 不保存历史帧，重连后请用 `GET /projects/:id/overview` + `GET /tasks?project_id=` 做一次全量对齐，
> 或对智能体面板改用 `GET /agents/runs/:runId/stream`（SSE 会先发 `run.snapshot` 再增量）。

---

## 15. 附：接口总览（按资源计数）

| 资源 | 端点数 |
| --- | --- |
| meta（health/meta/runtime/stats） | 4 |
| projects（含 segments/timeline/compose/exports/issues/clues） | 24 |
| scripts | 7 |
| shots | 15 |
| assets | 5 |
| characters | 8 |
| voices（含 emotions） | 8 |
| templates | 5 |
| tasks / scheduler | 7 |
| nodes / agent | 10 |
| agents（含 SSE） | 9 |
| llm | 9 |
| styles / comic | 9 |
| ws（`GET /api/v1/ws`） | 1 |
| **合计** | **121**（120 个 REST + 1 个 WebSocket） |


---

## 云端视频（APIMart）与本地 ComfyUI（v1.1 新增）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/providers/muse` | 返回 APIMart base_url / 模型 / 分辨率 / Key 是否配置（掩码）/ 账号池 |
| PUT | `/providers/muse` | 保存 `api_key` / `base_url` / `model` / `resolution`（Key 只落中台 `app_setting`） |
| POST | `/providers/muse/health` | 探测 APIMart 鉴权与连通性（`GET /models`，不产生生成计费） |
| GET/PUT | `/providers/comfy` | 读取 / 保存本地 ComfyUI 地址 |
| GET | `/comfy/status` | 读取 `/system_stats`，判断本地 ComfyUI 是否可达 |
| POST | `/comfy/probe` | 读 `/object_info`，按真实安装的 checkpoint / 采样器 / 视频节点自动生成模板并登记节点 |
| POST | `/comfy/test-run` | 用生成的模板向本地 ComfyUI 提交一次 8 步 512×512 试跑，返回 `prompt_id` |
| GET | `/comfy/history/{prompt_id}` | 查询试跑结果，返回图片代理地址 |
| GET | `/comfy/view` | 代理 ComfyUI `/view`，前端可直接显示生成图 |

**Muse 通道调用链**：`POST {MUSE_API_BASE}/videos/generations` → 返回 `data[0].task_id` → `GET {MUSE_API_BASE}/tasks/{task_id}` 轮询
（状态 SUCCESS / PROCESSING / FAILED，进度回写 WebSocket）→ 下载成片回存对象存储 → 资产 `meta.provider = "apimart"`、`simulated = false`。

**无 Key 行为**：自动生成导播代理片（真 WAV + FFmpeg 卡片），`meta.simulated = true`、`meta.simulate_reason = "NO_API_KEY"`，不会伪装成真实云端产物。
