# 玄枢・AURUM · 部署手册

> 玄枢・AURUM · AI 微综艺智造中枢：台本解析 → 智能体流水线 → 镜头 DAG 渲染 → 成片合成，单段硬上限 300 秒。

本目录（`deploy/`）只放**部署面**的文件：容器编排、网关配置、镜像构建、环境变量与机房配置基线。
业务代码在 `services/api`（Fastify + node:sqlite 业务中台）、`packages/core`（共享类型与常量）、`web`（React 18 + Vite 前端）。

---

## 0. 目录与职责

| 文件 | 作用 |
| --- | --- |
| `docker-compose.yml` | postgres(16) / redis(7) / minio / api / web 五容器编排；GPU 节点不在其中 |
| `Dockerfile.api` | 业务中台镜像：deps → build → runtime（`node --experimental-sqlite`） |
| `nginx.conf` | 静态托管 `web/dist` + `/api` 反代（WebSocket 升级、SSE 关缓冲、512m 上传） |
| `.env.example` | 全量环境变量样例，带中文注释与示例值 |
| `config.example.yaml` | 机房配置基线（engine / render / compose / storage 四段） |

---

## 1. 本地开发（Windows / macOS / Linux 通用）

要求：Node.js **>= 22.5**（`node:sqlite` 内置模块）、pnpm **10.33**、Python 3（仅备份脚本用）。

```bash
# 1) 安装依赖（monorepo 根执行）
pnpm install

# 2) 起开发态：API(8787, --watch) + Web(5273, vite dev)
pnpm dev

# 3) 播种样例数据（样例项目 + 3 类工作流模板 + GPU 节点 + 云端账号池）
pnpm seed
```

> `pnpm seed` 映射到 `services/api` 的 `seed` 脚本（`node --experimental-sqlite --import tsx src/tools/seed.ts`）。
> 该文件落在 `services/api/src/tools/` 下；如果该入口尚不存在，播种会在 **API 首次启动时自动执行**
> （`services/api/src/index.ts` 里的 `runSeed()`），此时重启一次 API 即可，重复播种是幂等的
> （模板按 `template_key` 判重、样例项目按名称判重）。

开发态常用命令：

```bash
pnpm dev:api                      # 只起 API，端口 8787
pnpm dev:web                      # 只起前端，端口 5273
pnpm typecheck                    # 全仓类型检查
pnpm --filter @aurum/api test     # 中台单测
node scripts/smoke.mjs            # 端到端冒烟：项目→智能体→落地→渲染 DAG→300s 硬约束→合成
AURUM_API=http://127.0.0.1:8787/api/v1 node scripts/smoke.mjs   # 指定地址
```

数据落在 `services/api/.data/`：`aurum.db`（SQLite）、`storage/`（素材，等同 MinIO 桶）、`exports/`（成片与字幕）。
清库重来：停进程后删掉 `services/api/.data`，下次启动自动建表 + 播种。

---

## 2. 生产启动（docker compose）

### 2.1 一次性准备

```bash
# 1) 配置环境变量（务必改掉 AGENT_TOKEN / POSTGRES_PASSWORD / MINIO_ROOT_PASSWORD）
cp deploy/.env.example deploy/.env
#    单机试跑时 NFS_HOST_ROOT 可留空，会回退到 deploy/nfs（容器内以 uid 1000 写；
#    宿主机目录需可写：chmod -R 777 deploy/nfs。真机部署请指向已挂载的 NAS 路径）

# 2) 构建前端产物（nginx 挂载的是 web/dist，不构建会 403）
pnpm install
pnpm --filter @aurum/web build

# 3) 校验编排与网关配置
cd deploy
python -c "import yaml; yaml.safe_load(open('docker-compose.yml', encoding='utf-8')); print('compose ok')"
docker compose config -q && echo "compose config ok"
```

### 2.2 启动与验证

```bash
cd deploy
docker compose up -d --build          # 首次构建 api 镜像（约 3-6 分钟）
docker compose ps                     # 五个服务应为 running/healthy
docker compose logs -f api            # 看启动日志："玄枢・AURUM API 已启动"
```

验证清单：

```bash
curl -s http://127.0.0.1:8787/api/v1/health        # {"ok":true,...}
curl -s http://127.0.0.1:8080/healthz              # ok（nginx 自身探活）
curl -s http://127.0.0.1:8080/api/v1/meta | head -c 300   # 经 nginx 反代的中台元数据
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/     # 200（前端 index.html）
node scripts/smoke.mjs                              # 走 8787 直连跑全链路
AURUM_API=http://127.0.0.1:8080/api/v1 node scripts/smoke.mjs   # 走 nginx 跑全链路
```

### 2.3 端口与访问面

| 服务 | 宿主端口 | 说明 |
| --- | --- | --- |
| web (nginx) | 8080 | 前端入口，`/api` 反代到 api:8787，`/files` 反代素材 |
| api | 8787 | 中台直连口（内网调试、GPU 节点回连用） |
| minio S3 | 9000 | 素材桶 API |
| minio console | 9001 | 控制台；注意 `.env` 里 `TTS_WORKER_URL` 默认值也是 9001，生产必须改成 GPU 节点地址 |
| postgres | 5432 | 仅当 `DATABASE_URL` 指向 postgresql 时使用 |

只用内嵌 SQLite、不想起 PG：

```bash
cd deploy
docker compose up -d redis minio api web   # 不写 postgres 即不会拉起它
# DATABASE_URL 留空或写成 file: 前缀，中台会用 /data/aurum.db
```

### 2.4 前后端分离部署（可选）

只想换前端、不动后端：`pnpm --filter @aurum/web build` 后把 `web/dist` 覆盖到 web 容器挂载点，
或直接 `docker compose restart web`（挂载是只读 bind，无需重建镜像）。

---

## 3. GPU 节点接入（ComfyUI / TTS / lip-sync）

> **三者都不进 compose。** 它们要独占显存、模型常驻、CUDA 驱动版本与宿主对齐，
> 一律在 GPU 物理机上以裸进程 + systemd 托管，通过 **反向拉取** 与中台通信：
> 节点主动发心跳、主动长轮询拉任务，中台从不主动连节点。

### 3.1 节点侧准备

```bash
# 1) 挂同一个 NFS（中间产物共享区，路径与中台 NFS_ROOT 一致）
sudo mkdir -p /nfs/aurum && sudo mount -t nfs 10.0.0.10:/export/aurum /nfs/aurum

# 2) ComfyUI（H3 本地渲染）
cd /opt/ComfyUI && python main.py --listen 0.0.0.0 --port 8188

# 3) TTS Worker（仓库自带 services/tts-worker，FastAPI 封装 IndexTTS-2）
cd services/tts-worker && pip install -r requirements.txt
HOST=0.0.0.0 PORT=9001 python tts_worker.py     # POST /synth、GET /health

# 4) lip-sync（MuseTalk），随 ComfyUI 或独立进程，按团队既有部署
```

### 3.2 用仓库自带 agent 拉起（推荐）

`services/agent/` 是官方 GPU 侧代理：注册 → 10s 心跳（独立线程）→ 长轮询拉任务 → 把 `params` 注入 `workflow_json` → 提交 ComfyUI → 回传产物（`base64` 或元数据）。
H3 单机并发强制 = 1，lipsync 走另一个单槽；`MOCK_MODE=1` 时完全联网外无依赖，无 GPU 也能把协议跑通。

```bash
cd services/agent
pip install -r requirements.txt

# 中台 origin（不要带 /api/v1，agent 的 center.py 自己拼）
export CENTER_URL=http://10.0.0.10:8787
export AGENT_TOKEN=<与 deploy/.env 里的 AGENT_TOKEN 一致>
export NODE_KEY=gpu-h3-01
export ENGINE_TAGS=h3,lipsync
export COMFYUI_URL=http://127.0.0.1:8188
export VRAM_TOTAL_GB=24
export H3_MAX_DURATION_SEC=8
export MOCK_MODE=0        # 0=真连 ComfyUI；1=无 GPU 也能跑通整条协议
python agent.py           # 自带 HTTP 面：GET /health、GET /status，默认监听 :9100
```

验证：

```bash
curl -s http://127.0.0.1:9100/status                          # 本地队列 / 显存 / 缺模型
curl -s http://10.0.0.10:8787/api/v1/nodes | python -m json.tool   # 应出现 node_key=gpu-h3-01、status=online
```

TTS 侧用 `services/tts-worker`：`pip install -r requirements.txt && python tts_worker.py` 监听 `:9001`，
提供 `POST /synth`、`GET /health`；中台 `TTS_WORKER_URL` 指向它即可（没装 IndexTTS-2 权重时自动降级为等长静音，字幕/时长链路照样可跑）。

### 3.3 手工协议验证（不用 agent 时）

中台地址与 token 从 `deploy/.env` 取。**`CENTER_URL` 只写 origin**（`services/agent/config.py` 负责拼 `/api/v1`）；
手工 curl 才需要带 `/api/v1` 前缀：

```bash
CENTER=http://10.0.0.10:8787/api/v1
TOKEN=change-me-aurum-agent-token

curl -s -X POST "$CENTER/agent/register" \
  -H "Content-Type: application/json" \
  -H "x-agent-token: $TOKEN" \
  -d '{
    "node_key": "gpu-h3-01",
    "base_url": "http://10.0.0.31:8188",
    "engine_tags": ["h3", "lipsync"],
    "vram_total_gb": 24,
    "models_loaded": ["h3_t2v_v1", "musetalk_v1"]
  }'
```

- `engine_tags` 决定派发：`h3` 接 `comfy_h3` 任务，`lipsync` 接口型对齐任务；
- 选点算法（`services/api/src/scheduler/executors.ts` 的 `selectNode`）：**显存空闲权重 0.6 + 队列长度权重 0.4**；
- 心跳超过 **30 秒** 未上报即判 `offline`，在跑任务回收重派（错误码 `NODE_OFFLINE`，recover 策略）。

### 3.4 心跳 + 拉任务循环（最小参考实现）

```bash
#!/usr/bin/env bash
# /opt/aurum-agent/agent.sh —— systemd 托管
set -euo pipefail
# CENTER_URL 只配 origin，这里补 /api/v1（agent.py 内部会自己补，脚本要手动补）
CENTER="${CENTER_URL%/}/api/v1"; TOKEN="${AGENT_TOKEN}"; NODE="gpu-h3-01"

heartbeat() {
  curl -s -X POST "$CENTER/agent/heartbeat" \
    -H "Content-Type: application/json" -H "x-agent-token: $TOKEN" \
    -d "{\"node_key\":\"$NODE\",\"base_url\":\"http://10.0.0.31:8188\",\"engine_tags\":[\"h3\",\"lipsync\"],\"vram_total_gb\":24,\"vram_free_gb\":${VRAM_FREE:-20},\"queue_len\":0,\"models_loaded\":[\"h3_t2v_v1\"]}" \
    > /dev/null
}

while true; do
  heartbeat
  # 长轮询 30s：有任务返回 200 + workflow_json，无任务返回 204
  TASK=$(curl -s -X GET "$CENTER/agent/tasks/pull?node=$NODE&wait=30" -H "x-agent-token: $TOKEN")
  if [ -n "$TASK" ]; then
    TASK_ID=$(echo "$TASK" | python -c "import sys,json; print(json.load(sys.stdin)['task_id'])")
    # ---- 此处交给 ComfyUI/MuseTalk 执行，中途上报进度 ----
    curl -s -X POST "$CENTER/agent/tasks/$TASK_ID/progress" \
      -H "Content-Type: application/json" -H "x-agent-token: $TOKEN" \
      -d '{"progress":50,"note":"采样中"}' > /dev/null
    # ---- 产物回传（base64 内联，或写到 NFS 同构路径后只回 external_id）----
    curl -s -X POST "$CENTER/agent/tasks/$TASK_ID/result" \
      -H "Content-Type: application/json" -H "x-agent-token: $TOKEN" \
      -d "{\"duration_ms\":5000,\"video_base64\":\"$(base64 -w0 /nfs/aurum/tmp/$TASK_ID.mp4)\"}" > /dev/null
  fi
  sleep 5
done
```

失败回传：`POST /agent/tasks/:id/fail`，body `{"error_code":"NODE_ERROR","error_msg":"显存不足"}`，
中台按错误码重试策略决定重排或置失败（见 `docs/ERROR_CODES.md`）。

### 3.5 systemd 单元示例

```ini
# /etc/systemd/system/aurum-agent.service
[Unit]
Description=玄枢・AURUM GPU Agent (ComfyUI/TTS/lip-sync bridge)
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/aurum-agent
# CENTER_URL 只写 origin；agent 内部拼 /api/v1（写 .../api 或 .../api/v1 也能兼容）
Environment=CENTER_URL=http://10.0.0.10:8787
Environment=AGENT_TOKEN=change-me-aurum-agent-token
Environment=NODE_KEY=gpu-h3-01
Environment=ENGINE_TAGS=h3,lipsync
Environment=COMFYUI_URL=http://127.0.0.1:8188
Environment=VRAM_TOTAL_GB=24
Environment=H3_MAX_DURATION_SEC=8
Environment=MOCK_MODE=0
# 推荐直接起仓库自带的 agent.py；若用上面 3.4 的 shell 循环则换成 /opt/aurum-agent/agent.sh
ExecStart=/opt/aurum-agent/venv/bin/python /opt/aurum-agent/agent.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now aurum-agent
curl -s http://10.0.0.10:8787/api/v1/nodes | python -m json.tool   # 确认 status=online
```

### 3.6 中台侧开关

- `COMFY_SIMULATE=true`（默认）：本地渲染走模拟产物，**没有 GPU 也能跑通全流程**；接真机后置 `false`；
- `LIPSYNC_ENABLED`：口型对齐总开关；`LIPSYNC_TRIGGER=close_up_only` 只对特写类机位生效；
- `TTS_WORKER_URL`：指向 TTS Worker 内网地址（不要留 127.0.0.1:9001）；
- `H3_CONCURRENCY`：单节点并发，24G 显存建议 1。

---

## 4. 备份策略

| 对象 | 方式 | 频率 | 保留 | 恢复演练 | 说明 |
| --- | --- | --- | --- | --- | --- |
| **PostgreSQL**（业务库） | `pg_dump -Fc` 自定义格式 | **每日** 03:00 | **30 天** | 每月一次 `pg_restore` 到临时库 | 只备份项目/台本/任务/资产元数据，不含量产文件 |
| SQLite（默认部署） | 停写后拷 `/data/aurum.db` + WAL | 每日（同窗口） | 30 天 | 每季度 | 用 `sqlite3 aurum.db ".backup /backup/aurum-$(date +%F).db"`，避免直接 cp 造成半写 |
| **MinIO**（素材/成片） | `mc mirror --preserve` 到异地桶 | **每周**（周日 04:00） | 12 周滚动 | 每季度抽检 3 个对象 | 只增不改，优先保证成片与台本导出的可恢复性 |
| **NFS 中间产物** | **不备份** | — | 72 小时自动清理 | — | `/nfs/aurum/{frames,audio,tmp}` 是渲染中间态，可从台本 + 素材重算；备份它只会拖慢窗口 |

参考脚本（宿主机 cron）：

```bash
# /etc/cron.d/aurum-backup
# PostgreSQL：每日 03:00 全量导出，保留 30 天
0 3 * * *  postgres  docker exec aurum-postgres pg_dump -U aurum -Fc aurum > /backup/pg/aurum-$(date +\%F).dump
5 3 * * *  root      find /backup/pg -name 'aurum-*.dump' -mtime +30 -delete

# MinIO：每周日 04:00 镜像到备份桶
0 4 * * 0  root      docker run --rm --network aurum-stage_default -v /backup/minio:/backup minio/mc \
                      sh -c 'mc alias set src http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" && mc mirror --preserve src/aurum /backup/aurum'
```

恢复顺序（灾难场景）：**PostgreSQL/SQLite → MinIO 桶 → 起 api → 起 web**。
恢复 `aurum.db` 或 PG 之后，任务表里 `pending/running` 的历史任务会被调度器重新拾起；
若只想恢复数据不想重跑渲染，先把 `SCHEDULER_ENABLED=false` 起来，核对完再打开。

---

## 5. 常见故障对照

| 现象 | 定位 | 处理 |
| --- | --- | --- |
| `docker compose up` 后 web 打开是 403 | `web/dist` 没构建，nginx 目录为空 | `pnpm --filter @aurum/web build` 后 `docker compose restart web` |
| api 反复重启，日志 `ERR_UNKNOWN_FILE_EXTENSION .ts` | 入口没走 tsx（用了编译后的 dist） | 用镜像内置 `CMD`；本地跑 `pnpm serve` |
| 合成返回 `mode=manifest`、`COMPOSE_NO_FFMPEG` | 没找到 ffmpeg | 设 `FFMPEG_PATH=/usr/bin/ffmpeg` 或在镜像内保留 ffmpeg-static |
| 任务卡 `pending` 且 `error_code=NODE_OFFLINE` | 没有 online 节点带对应 tag | 检查节点心跳、`engine_tags` 是否含 `h3`/`lipsync`，或临时 `COMFY_SIMULATE=true` |
| 提交渲染返回 `SEGMENT_DURATION_EXCEED` (422) | 该段累计 >300 秒硬上限 | 删减镜头或拆分环节；见 `docs/ARCHITECTURE.md` 的 300s 校验点 |
| SSE 面板不动 | 反代缓冲没关 | 确认 `nginx.conf` 里 `/api/` 的 `proxy_buffering off`，且响应头带 `X-Accel-Buffering: no` |
| 大文件上传 413 | 请求体超过网关限制 | `client_max_body_size 512m` 已配置；超过则改大或走 MinIO 直传 |
| 大文件上传 500 / `FST_ERR_CTP_BODY_TOO_LARGE` | 中台 Fastify `bodyLimit` 固定 128MB，比网关的 512m 更小 | 128MB 以内走 `/projects/:id/assets`；更大的文件先直传 MinIO，再登记 `object_key` |
| `TTS_WORKER_URL` 连到 MinIO 控制台 | 默认 9001 端口撞车 | 改成 GPU 节点内网地址 + 真实端口 |

---

## 6. 安全与运维基线

- `AGENT_TOKEN` 是唯一的中台↔节点凭证（请求头 `x-agent-token`），**投产必须改**，并只在内网下发；
- 8787 与 9000/9001 只对内网/VPN 开放，公网只暴露 8080；
- 素材含人脸/声音，涉及授权：`character_asset.authorization_file_hash`、`authorized_until` 到期前由运营复核；
- 日志落在容器 stdout（`json-file` 已限 20m×5），需要集中检索时在宿主加 fluent-bit/filebeat；
- 升级流程：`git pull` → `pnpm --filter @aurum/web build` → `docker compose build api && docker compose up -d`；
  数据库改动只走 `services/api/src/db/schema.ts` 的 `CREATE TABLE IF NOT EXISTS`，启动即幂等建表。
