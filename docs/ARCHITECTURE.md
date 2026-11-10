# 系统架构 · 玄枢・AURUM

> AI 微综艺智造中枢。台本进、成片出，单段硬上限 **300 秒**。
> 本文所有结论都对应仓库里的实现：`services/api/src/**`、`packages/core/src/**`、`web/**`。

---

## 1. 分层视图

| 层 | 名称 | 目录 | 职责 | 关键约束 |
| --- | --- | --- | --- | --- |
| **L1** | 前端（导播台） | `web/` | 项目/台本/分镜/时间轴/合规面板/智能体面板；订阅 WebSocket 与 SSE | 只通过 `/api/v1` 访问后端，不直连 GPU；组件禁止硬编码色值（见 `docs/DESIGN_SYSTEM.md`） |
| **L2** | 业务中台 | `services/api/src/{routes,domain,engine,media,db,llm}` | REST/WS 网关、台本解析、时长合规、素材与模板、LLM 供应商池、SQLite 持久化 | 单进程 Fastify；`bodyLimit` 128MB；错误统一 `{ok:false,error:{code,ui_hint,retry}}` |
| **L3** | 调度层 | `services/api/src/scheduler/{scheduler,task-service,executors}.ts` | 任务 DAG 建链与幂等、分级并发派发、重试矩阵、节点看门狗、心跳回收 | tick 350ms；单 tick 最多派发 40 个 pending；同类型并发受配置约束 |
| **L4** | 适配器与 GPU 节点 | `services/api/src/adapters/*` + GPU 物理机 | TTS（IndexTTS-2）、本地渲染（ComfyUI·H3）、云端渲染（Muse Video）、口型对齐（MuseTalk）、对象存储、账号池 | GPU 节点**反向拉取**任务，不进 compose；中台从不主动连节点 |

**依赖方向**：L1 → L2 → L3 → L4，反向只允许事件回传（WS 事件 / SSE / 节点回调），不允许 L4 直接改 L1 状态。

---

## 2. ASCII 架构图

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ L1  导播台 · 浏览器  http://<host>:8080                                                      │
│ React 18 + Vite（dev :5273）· 设计 token：web/src/styles/{tokens,app}.css                    │
│ REST /api/v1/**   ·   WS /api/v1/ws   ·   SSE /api/v1/agents/runs/:id/stream                 │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
                                                │  HTTP / WebSocket
                                                ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ 网关  nginx:alpine · deploy/nginx.conf                                                       │
│ 托管 web/dist（SPA 回退 index.html）· /api 反代 api:8787（Upgrade 透传）· /files 反代素材    │
│ proxy_buffering off（SSE / 长轮询）· client_max_body_size 512m                               │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
                                                │  proxy_pass http://api:8787
                                                ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ L2  业务中台  Fastify 5 · node:sqlite · 单进程 · :8787                                       │
│ routes/   meta projects scripts shots assets characters voices templates tasks nodes         │
│           agents llm styles ws                                                               │
│ domain/   project-service · script-service · timeline-service · mappers                      │
│ engine/   script-parser（台本→结构化） · compliance（300s 判定 + 镜头时长复算）              │
│ media/    ffmpeg（归一化/拼接/混音/ASS 压制） · subtitles（SRT/ASS） · wav（BGM 铺底）       │
│ llm/      供应商池 + 结构化调用 + 用量      db/  schema（27 表）· seed（样例数据）           │
│ ws/       hub：task.* / node.offline / compose.* / agent.event（按 project_id 过滤）         │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
                                                │  建任务 / 读任务状态
                                                ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ L3  调度层  scheduler.tick 350ms（单 tick 最多派发 40 个 pending）                           │
│ watchdog   心跳 >30s → offline → 在跑任务回收重派（NODE_OFFLINE）                            │
│ dispatch   依赖晋升 + 分级并发（tts/muse_api/comfy_h3/lipsync/compose）+ 选点                │
│            选点打分 = vram_free 0.6 + 1/(queue+1) 0.4，且必须含所需 tag                      │
│ task-service  DAG 建链 + 幂等键（sha256）+ 重试/取消    executors  执行器 + 素材回写         │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
                                                │  assigned（长轮询）/ 本地执行 / 云端 HTTPS
                                                ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ L4  适配器与 GPU 节点（裸进程 + systemd 托管，不进 compose）                                 │
│ ComfyUI·H3  :8188   ←  GET /api/v1/agent/tasks/pull?node=<key>&wait=30                       │
│                      返回 {task_id, workflow_json, params}，执行后回传                       │
│ IndexTTS-2  :9001   ←  同步 POST /synth（中台 TTS_WORKER_URL，3 候选）                       │
│ MuseTalk  lip-sync  →  POST /agent/tasks/:id/{progress,result,fail}                          │
│ Muse Video API（云端·鎏金）  ←→  HTTPS + 账号池 + QPS 限流（不经 GPU 节点）                  │
│ 素材面  storage 适配器：local(/data/storage) ↔ MinIO(:9000) ; NFS 中间产物交换区             │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

**一句话读图**：L1 只认 `/api/v1`；L2 把台本变成「环节 + 镜头 + 任务」；L3 把任务按依赖与并发派出去；L4 用「节点反向拉取 + 云端 HTTP」两种形态吃下算力；所有事件经 `ws/hub` 回到 L1。

---

## 3. 一次渲染的链路（时序）

```
POST /api/v1/shots/:shotId/render
  │
  ├─ assertSegmentCompliance(project, segment)     ← 300s 硬闸口（超限直接 422，不建任务）
  ├─ submitShotRender()
  │    ├─ createTask(tts)        priority 1  idempotency=sha256(shot|text|emotion|…)
  │    ├─ createTask(comfy_h3|muse_api) priority 5  depends_on=[tts]   （privacy+muse_api → PRIVACY_BLOCK）
  │    └─ createTask(lipsync)    priority 4  depends_on=[tts, video]   （仅 lipsync_required && !native_audio）
  ├─ shot.status = queued（locked 保持 locked）
  └─ emit task.created → WS
        │
scheduler.tick（350ms）
  ├─ 取 pending 40 条，按 priority ASC, created_at ASC
  ├─ depsSatisfied？ → 未完成则等；失败/取消/超时则置 blocked 并广播 task.failed
  ├─ 同类型并发已满？→ 等下一 tick
  ├─ needAgent？→ assigned + emit task.assigned，等节点长轮询拿走
  └─ 否则本地执行 runOne → 适配器 → emit task.progress / task.preview / task.success
        │
GPU 节点 GET /agent/tasks/pull?node=<key>&wait=30 → 200 + workflow_json（已注入参数）
  ├─ POST /agent/tasks/:id/progress  → 中台 emit task.progress
  ├─ POST /agent/tasks/:id/result    → 落素材 + applyVideoResult + emit task.success
  └─ POST /agent/tasks/:id/fail      → status 回 pending、attempt+1、emit task.failed
```

---

## 4. 任务 DAG 与失败传播

### 4.1 DAG 形状

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ tts (P1)     配音：每句台词生成 3 个候选，实测时长回填镜头                      │
└─────────────────────────────────────────────────────────────────────────────────┘
                                         │  depends_on
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ video (P5)   comfy_h3（本地·青玉） 或 muse_api（云端·鎏金）                     │
│              目标时长 = tts 实测时长 + 300ms 呼吸留白                           │
└─────────────────────────────────────────────────────────────────────────────────┘
                                         │  depends_on
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ lipsync (P4)  MuseTalk；仅特写类机位且未用原生音轨；失败 fail-open 保留原片     │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 依赖晋升规则（`scheduler.ts · dispatchPending / depsSatisfied`）

| 上游状态组合 | 下游动作 | 任务状态 | 事件 / 错误码 |
| --- | --- | --- | --- |
| 依赖全部 `success` | 进入派发 | `pending → assigned/running` | `task.assigned` / `task.progress` |
| 有依赖仍在 `pending/assigned/running` | 本轮跳过，下个 tick 再看 | 保持 `pending` | 无 |
| 任一依赖 `failed / canceled / timeout` | **阻断**，永不启动下游 | `blocked` | `task.failed` + `error_msg="上游任务失败（id…），未启动下游"` |

> 记为 `blocked` 的任务不会自动复活：修好上游后要 `POST /tasks/:id/retry` 或重提镜头渲染。
> 这是刻意的：避免下游在错误素材上继续烧 GPU。

### 4.3 重试矩阵（`packages/core/src/errors.ts` 的 `retry` 字段 + `scheduler.retryDecision`）

| retry 策略 | 命中错误码举例 | 行为 |
| --- | --- | --- |
| `none` | `PARAM_INVALID` `PRIVACY_BLOCK` `TTS_TEXT_INVALID` `SEGMENT_DURATION_EXCEED` | 直接置 `failed`，等人工修 |
| `reassign`（换号/换节点） | `QUOTA_EXHAUSTED` `NODE_ERROR` `LLM_UNAVAILABLE` | `attempt+1` 回 `pending`，`node_id` 清空，重新选点/换账号 |
| `cooling`（冷却后换号） | `RATE_LIMITED` | 同上，但按账号 `cooldown_until` 冷却 |
| `cloud-retry` | `CLOUD_TIMEOUT` `LLM_SCHEMA_FAIL` | 最多 2 次 |
| `degrade-once` | `OOM` `COMPOSE_CONCAT_FAIL` | 重试 1 次并置 `engine_params.degraded=1`（降参/降规格） |
| `recover` | `NODE_OFFLINE` | 任务回收重派（看门狗触发） |

重试次数上限取 `max(task.max_attempt, errorMeta.maxAttempt)`；未成功的最终态写 `round_shot.error_code`，前端直接展示 `ui_hint`。

### 4.4 节点看门狗

- 心跳字段 `agent_node.last_heartbeat`，超过 **30s** 未更新 → `status='offline'`，广播 `node.offline`；
- 该节点上 `assigned/running` 的任务回 `pending`、`node_id=NULL`、`error_code='NODE_OFFLINE'`、`progress=0`；
- 没有可用节点的 `comfy_h3/lipsync` 任务只打 `error_code='NODE_OFFLINE'`（`error_msg='无可用 GPU 节点'`）不派发，等待节点上线。

### 4.5 并发与选点

| 任务类型 | 并发上限 | 来源 |
| --- | --- | --- |
| `tts` | `TTS_CONCURRENCY`（默认 4） | `TYPE_CONCURRENCY` |
| `muse_api` | `min(3, MUSE_QPS)` | 云端 QPS 保护 |
| `comfy_h3` | `H3_CONCURRENCY`（单节点，默认 1） | 显存保护 |
| `lipsync` | 2 | 固定 |
| `compose` | 1 | 串行，避免 FFmpeg 抢 CPU |

选点打分：`score = (vram_free/vram_total)×0.6 + 1/(queue_len+1)×0.4`，只在 `status='online'` 且 `engine_tags` 含所需 tag（`h3` / `lipsync`）的节点里挑最高分。

---

## 5. 300 秒硬约束的四个校验入口

单段成片上限是产品契约（`SEGMENT_CAP_MS = 300_000`，预警线 280s）。判定函数只有一个：`engine/compliance.ts · evaluateSegment`，
段时长 = Σ 单镜头有效时长 + `SHOT_GAP_MS`×(镜头数-1)；单镜头有效时长优先取 `tts_duration_ms + 300ms`（呼吸留白），其次 `duration_ms`，再次 `target_duration_ms`，兜底 3000ms。

| # | 入口 | 代码位置 | 触发时机 | 判定与行为 |
| --- | --- | --- | --- | --- |
| 1 | **解析落库** | `POST /scripts/:scriptId/parse`、`POST /projects/:id/parse-preview`、智能体落地 `persistStructuredScript` → `recomputeAll` → `complianceOfProject` | 台本结构化写库后立刻复算 | **不抛错**（保留编导可编辑空间），但把每段 `status` 写成 `ok / near(≥280s) / exceed(>300s)`，并给出 `split_suggestion`（超限位置附近的镜头边界）；前端据此标红条。智能体 QA 阶段同步产出 `quality_issue(SEGMENT_DURATION_EXCEED)` |
| 2 | **TTS 回填** | `scheduler/executors.ts · executeTts`（写 `tts_duration_ms`、`duration_ms = tts + 300`）→ 视频/口型完成后 `applyVideoResult`/`executeLipsync` 调 `recomputeAll` | 每句台词配音完成后 | 段时长随**实测配音**变化，可能从 ok 变 near/exceed；候选音频落 `shot_candidate(kind='tts')`，`POST /shots/:id/candidates/:cid/select` 换候选会同步改写镜头时长 |
| 3 | **提交渲染** | `POST /shots/:shotId/render`、`POST /projects/:id/render-all` → `assertSegmentCompliance` | 建 DAG **之前** | **硬闸口**：任一命中段 `exceed` 即返回 `422 SEGMENT_DURATION_EXCEED`，带 `segment_id/title/duration_sec/exceed_sec/split_hint`；不建任务、不产生计费 |
| 4 | **合成** | `POST /projects/:id/compose` → `composeProject` → `composePlan` | 导出成片时 | 按镜头重建时间轴（`total_ms` 写入 manifest 与 `compose_export`）；空范围抛 `SEGMENT_EMPTY`；**不做二次 300s 判定**——因为前三处已挡住，此处只如实记录时长；无 FFmpeg 时降级 `mode=manifest`（`COMPOSE_NO_FFMPEG`） |

补充：`patchedShot` 改台词/语速会重算 `duration_ms` 并 `recomputeAll`；`reorderShots`、`createShot`、`deleteShot` 同理。
换言之，任何改变镜头时长的写操作都会立刻反映到合规面板，只有「提交渲染」这一处是**阻断式**校验。

---

## 6. 数据表清单与关键字段

SQLite 落地（`services/api/src/db/schema.ts`），字段与 PostgreSQL DDL 一一对应；启动时 `CREATE TABLE IF NOT EXISTS` 幂等建表。

| # | 表 | 作用 | 关键字段 |
| --- | --- | --- | --- |
| 1 | `project` | 项目（一部微综艺） | `name` `variety_type` `aspect_ratio` `fps` `visual_style` `privacy_mode` `style_prompt/negative` `style_ref_asset_id` `segment_cap_sec(300)` `status` |
| 2 | `script` | 台本版本 | `project_id` `raw_md` `structured_json` `parse_status` `parse_report` `version` |
| 3 | `segment` | 环节（分集内的段） | `project_id` `seq` `segment_type` `title` `default_engine` `visual_style` `duration_ms`（由镜头复算） |
| 4 | `round_shot` | 镜头（最小生产单元） | `segment_id` `shot_code` `speaker_role_id/name` `camera` `lines` `text_clean` `emotion(+instruction)` `performance_tags` `visual_prompt/negative_prompt` `render_engine` `engine_params` `tts_engine/voice_id/tts_speed` `tts_duration_ms` `tts_asset_id` `lipsync_required/lipsync_asset_id` `native_audio` `privacy` `status` `duration_ms` `preview_asset_id` `locked` `error_code` |
| 5 | `character_asset` | 角色（含版本与授权） | `role_id` `version` `name` `role_type` `persona` `prompt_prefix/negative_extra` `lock_seed` `seed` `anchor_prompt` `authorization_file_hash` `authorized_until` `is_active` |
| 6 | `character_ref_image` | 角色参考图 | `character_id` `asset_id` `angle` `weight` |
| 7 | `voice_asset` | 音色 | `voice_id` `role_id` `provider` `base_speed` `available_emotions` `forbidden` `authorization_file_hash` `authorized_until` |
| 8 | `voice_ref_audio` | 音色参考音频（6–15s，≥2 条，含 emotional_peak） | `voice_id` `asset_id` `ref_type` `duration_sec` `note` |
| 9 | `workflow_template` | ComfyUI/云端/TTS 工作流模板 | `template_key(UNIQUE)` `template_type` `template_body` `param_map` `params_schema` `constraints` `enabled` `visual_style` |
| 10 | `render_task` | 任务 DAG 节点 | `task_type` `engine` `engine_params` `idempotency_key(UNIQUE)` `status` `priority` `node_id` `external_task_id` `attempt/max_attempt` `depends_on(JSON)` `progress` `error_code/error_msg` `result_asset_id` `started_at/finished_at` |
| 11 | `shot_candidate` | 镜头候选（3 选 1） | `shot_id` `kind(tts/video/lipsync)` `idx` `asset_id` `duration_ms` `state(selected/ready/pending)` `meta` |
| 12 | `asset` | 素材索引（对象存储指针） | `project_id` `asset_type` `source` `bucket` `object_key` `nfs_path` `thumb_key` `width/height` `duration_sec` `meta` |
| 13 | `timeline_item` | 时间轴轨道（video/subtitle/flower/audio_voice/audio_bgm/audio_sfx） | `project_id` `shot_id` `track` `start_ms/end_ms` `asset_id` `payload` `locked` |
| 14 | `render_account` | 云端账号池 | `provider` `account_name` `secret_ref` `quota_used/quota_limit` `cooldown_until` `enabled` |
| 15 | `agent_node` | GPU 节点 | `node_key(UNIQUE)` `base_url` `engine_tags` `vram_total_gb/vram_free_gb` `queue_len` `status` `models_loaded` `last_heartbeat` |
| 16 | `audit_log` | 审计 | `project_id` `actor` `action` `target` `detail` |
| 17 | `compose_export` | 合成导出记录 | `project_id` `segment_id` `task_id` `status(mp4/manifest)` `duration_ms` `video_asset_id` `subtitle_asset_id` `ass_asset_id` `manifest` `error_code/error_msg` |
| 18 | `llm_provider` | LLM 供应商 | `provider_key` `protocol` `base_url` `api_keys` `enabled` `is_default` `health` `meta` |
| 19 | `llm_model` | 供应商可用模型 | `provider_id` `model_id` `capabilities` `context_len` `discovered` |
| 20 | `llm_usage` | 用量与延迟 | `provider` `model` `purpose` `tokens_in/out` `latency_ms` `ok` |
| 21 | `project_llm_override` | 项目级模型覆盖 | `project_id(PK)` `provider_id` `model_id` `params` |
| 22 | `agent_run` | 智能体流水线一次运行 | `project_id` `goal` `source_kind/source_text` `target_sec` `stage` `status` `outputs` `events(JSON, 末 200 条)` `script_id` |
| 23 | `agent_stage` | 六个阶段的状态机 | `run_id` `stage` `agent` `status` `summary` `payload` `started_at/finished_at`（UNIQUE run_id+stage） |
| 24 | `quality_issue` | 质检问题 | `project_id` `run_id` `shot_id` `segment_id` `level` `code` `message` `suggestion` `resolved` |
| 25 | `clue` | 一致性线索（道具/服装/口头禅） | `project_id` `clue_key(UNIQUE per project)` `kind` `description` `anchor` `first_shot_id` `pinned` |
| 26 | `comic_panel` | 漫画面板 / 宫格 / webtoon | `project_id` `segment_id` `shot_id` `seq` `layout(grid_4/6/9)` `panel_json` `preview_asset_id` |
| 27 | `app_setting` | 运行时键值配置 | `key(PK)` `value` |

**关系要点**：`project 1—n segment 1—n round_shot`（`ON DELETE CASCADE`）；`round_shot 1—n shot_candidate`；`render_task` 通过 `project_id/shot_id/segment_id` 反查，`depends_on` 存任务 id 数组；素材一律只存指针（`bucket + object_key`），文件本体在 MinIO 或本地 `storage/<bucket>/<key>`。

---

## 7. 关键常量与状态机

| 常量 | 值 | 位置 | 说明 |
| --- | --- | --- | --- |
| `SEGMENT_CAP_MS/SEC` | 300000 / 300 | `packages/core/src/constants.ts` | 硬上限，不可配置 |
| `SEGMENT_NEAR_MS/SEC` | 280000 / 280 | 同上 | 预警线（93.3%） |
| `SHOT_DURATION_WARN_MIN/MAX_MS` | 2000 / 8000 | 同上 | 镜头时长仅警告 |
| `H3_MAX_DURATION_SEC` | 8 | 同上 | 本地单片段上限 |
| `BREATH_MS` | 300 | 同上 | 视频目标时长 = TTS + 300ms |
| `SHOT_GAP_MS` | 200 | 同上 | 镜头间呼吸留白 |

- **任务状态**：`pending → assigned → running → success`；异常分支 `failed / timeout / canceled / blocked`。
- **镜头状态**：`empty → queued → rendering → generated → reviewed → locked`（`deriveShotStatus` 只允许单向晋升，`locked` 不被降级）。
- **智能体阶段**：`characters → outline → script → casting → storyboard → qa`（`STAGES`），运行态 `running → ready → applied | failed`。
- **引擎双通道**：`muse_api`（云端·鎏金·cloud）/ `comfy_h3`（本地·青玉·local）；`privacy` 镜头禁止走云端（`PRIVACY_BLOCK`）。

---

## 8. 代码地图（改哪里找哪里）

```
services/api/src/
├─ app.ts                  Fastify 组装、错误处理器、静态托管、bodyLimit
├─ index.ts                启动：ensureDirs → getDb → runSeed → listen → 优雅退出
├─ config.ts               全部环境变量解析（deploy/.env.example 的契约来源）
├─ routes/                 14 个 REST 模块 + ws，全部挂在 /api/v1
├─ domain/                 项目/台本/时间轴服务与领域映射
├─ engine/                 script-parser（台本→结构化）、compliance（300s 判定）
├─ scheduler/              scheduler（tick/watchdog/dispatch）、task-service（DAG/幂等/重试）、executors（执行/选点）
├─ adapters/               tts / video / compose / lipsync / storage / poster / accounts
├─ media/                  ffmpeg / subtitles / wav
├─ llm/                    service（供应商池与结构化调用）/ backends
├─ orchestration/          orchestrator（六阶段智能体）/ fallback（规则兜底 + QA）
├─ db/                     schema（27 表）/ seed（样例数据）
└─ ws/hub.ts               事件广播：task.* / node.offline / compose.* / agent.event
```

扩展新引擎（例如再加一家云端）：`adapters/video.ts` 增加 provider → `executors.executeVideo` 分派 → `packages/core` 的 `RENDER_ENGINES` 与 `ENGINE_META` 补枚举/配色 → 前端引擎徽标自动跟随。
