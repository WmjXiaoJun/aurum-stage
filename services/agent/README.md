# services/agent · 玄枢 GPU 侧 ComfyUI Agent

部署在每台 GPU 机器上的节点代理：向中台注册自己 → 每 10s 心跳 → 长轮询拉 `comfy_h3` / `lipsync` 任务
→ 把 `params` 注入 `workflow_json` → 提交 ComfyUI `/prompt` → 监听 `/ws` 回传进度
→ 取 mp4 产物 → `base64` 回传中台。

- 协议对齐：`services/api/src/routes/nodes.ts`（`/api/v1/agent/*`，鉴权头 `X-Agent-Token`）
- 参数注入语义：与 `services/api/src/adapters/video.ts` 的 `injectWorkflow` 同构（`workflow.py`）
- **H3 单机并发强制 = 1**（`threading.Semaphore(1)`）；lipsync 独占另一个单槽
- **心跳走独立线程**，只做 HTTP，不抢任务槽，长任务不会把节点心跳拖死
- **`MOCK_MODE=1`（默认）** 不连 ComfyUI：按 `params.target_duration_ms` 线性 sleep（上限 `H3_MAX_DURATION_SEC`），
  只回 `{duration_ms, meta:{mock:true}}`，没有 GPU 也能把整条协议跑通

## 启动（3 行）

```bash
pip install -r requirements.txt
export CENTER_URL=http://127.0.0.1:8787 AGENT_TOKEN=aurum-dev-agent-token NODE_KEY=gpu-a ENGINE_TAGS=h3,lipsync
python agent.py
```

Windows PowerShell 等价写法：

```powershell
pip install -r requirements.txt
$env:CENTER_URL="http://127.0.0.1:8787"; $env:AGENT_TOKEN="aurum-dev-agent-token"; $env:NODE_KEY="gpu-a"; $env:ENGINE_TAGS="h3,lipsync"
python agent.py
```

Agent 自身 HTTP 面：`GET /health`（探活）、`GET /status`（队列/显存/缺模型），默认监听 `0.0.0.0:9100`。
容器化：`docker build -t aurum-agent . && docker run --env-file .env -p 9100:9100 aurum-agent`（CPU 版镜像，默认 mock）。

## 协议表

| 方法 | 路径 | 请求体 / 参数 | 期望响应 |
| --- | --- | --- | --- |
| POST | `{CENTER_URL}/api/v1/agent/register` | `{node_key, base_url, engine_tags:["h3","lipsync"], vram_total_gb, models_loaded:[]}`，头 `X-Agent-Token` | `{ok:true, node:{...}}` |
| POST | `{CENTER_URL}/api/v1/agent/heartbeat` | `{node_key, engine_tags, vram_total_gb, vram_free_gb, queue_len, models_loaded}`，每 10s | `{ok:true, next_heartbeat_ms:10000}` |
| GET | `{CENTER_URL}/api/v1/agent/tasks/pull?node=gpu-a&wait=30` | query：`node`、`wait`（秒，≤30） | `200` → `{task_id, shot_id, task_type, workflow_template, workflow_json, param_map, params}`；`204` 无任务 |
| POST | `{CENTER_URL}/api/v1/agent/tasks/{id}/progress` | `{progress: 0-100, note}` | `{ok:true}` |
| POST | `{CENTER_URL}/api/v1/agent/tasks/{id}/result` | `{duration_ms, video_base64?, external_id, meta}` | `{ok:true, asset_id}` |
| POST | `{CENTER_URL}/api/v1/agent/tasks/{id}/fail` | `{error_code, error_msg}`，`error_code ∈ OOM / NODE_ERROR / TIMEOUT / MODEL_MISSING` | `{ok:true}` |

`pull` 收到 `404`（节点未注册，中台重启过）会自动重新 `register` 后继续长轮询。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `CENTER_URL` | `http://127.0.0.1:8787` | 中台 origin；写成 `.../api` 或 `.../api/v1` 也能自动兼容 |
| `AGENT_TOKEN` | `aurum-dev-agent-token` | 与中台 `AGENT_TOKEN` 一致，放 `X-Agent-Token` 头，日志里永久脱敏 |
| `NODE_KEY` | 主机名 | 节点唯一键，中台按它选点（如 `gpu-a`） |
| `NODE_BASE_URL` | `http://127.0.0.1:9100` | 本 Agent 对外地址，注册时上报 |
| `ENGINE_TAGS` | `h3,lipsync` | 支持的引擎标签，中台按 tag 选点 |
| `COMFYUI_URL` | `http://127.0.0.1:8188` | ComfyUI 地址（`/prompt`、`/ws`、`/history`、`/view`） |
| `VRAM_TOTAL_GB` | `24` | 卡片总显存，用于心跳与 OOM 预检 |
| `H3_MAX_DURATION_SEC` | `8` | 单段上限，超出的 `target_duration_ms` 会被夹断并记 `duration_clamped` |
| `MOCK_MODE` | `1` | `1` 不连 ComfyUI，只 sleep 回元数据；`0` 走真实链路 |

可选补充：`AGENT_HTTP_PORT`(9100)、`AGENT_HTTP_HOST`(0.0.0.0)、`AGENT_LOG_LEVEL`(info)、`AGENT_MODELS`（心跳上报的已加载模型）、
`AGENT_REQUIRED_MODELS`（启动自检清单，默认 `minimax_h3,ipadapter_sdxl,musetalk`）、`AGENT_VRAM_FREE_GB`（覆盖显存余量）、
`COMFYUI_API_KEY`（ComfyUI 前置鉴权时的 Bearer Token）、`MOCK_TIME_RATIO`(0.25)、`QUEUE_WAIT_SEC`(900)、`WS_TIMEOUT_SEC`(30)。

## 错误分类

| 场景 | error_code | 触发点 |
| --- | --- | --- |
| 显存不足（`cuda out of memory` / 预检不够） | `OOM` | `_check_vram`、`/prompt` 与 `execution_error` 文本分类 |
| 节点/类或 workflow 校验失败 | `NODE_ERROR` | `/prompt` 4xx、`node_errors`、`execution_error`、websocket 断开 |
| 整体执行超时、等槽超时 | `TIMEOUT` | `deadline`、`Semaphore.acquire(timeout=)` |
| 启动自检缺模型（权重文件缺失） | `MODEL_MISSING` | `self_check`：缺模型时置 `models_ok=False`，后续任务直接 `MODEL_MISSING` 并打日志 |

## 日志

一行一条 JSON（stdout/stderr），固定字段 `ts / level / event / node_key`，任务相关带 `task_id / latency_ms / duration_ms / error_code`。
`X-Agent-Token` 与 `AGENT_TOKEN` 值经 `logutil.redact` 永久替换为 `***`，不会出现在任何一行日志或异常栈里。

```json
{"ts":"2026-11-07T11:39:46.412+00:00","level":"info","event":"task_result","node_key":"gpu-a","task_id":7,"task_type":"comfy_h3","latency_ms":1031,"duration_ms":4000,"video_bytes":0,"mock":true,"asset_id":101}
```

## 接真实 ComfyUI 的 4 处 TODO

全文搜 `TODO(真实 ComfyUI`：

1. `#1` `comfy_submit` / `_comfy_headers` —— 鉴权（Basic Auth / 网关 Token / `COMFYUI_API_KEY`）、反代路径、`/prompt` 接口形态。
2. `#2` `comfy_fetch_output` —— 产物节点字段白名单（`videos|gifs|images`）与 `_VIDEO_EXTS`，换 `SaveAnimatedWEBP` 之类要同步改；
   同机部署也可以改成直接读 ComfyUI `output` 目录。
3. `#3` `comfy_watch_progress` —— `/ws` 消息名与完成判定（`progress` / `executing(node=None)` / `/history` 有条目），换新版 messages API 在这里补。
4. `#4` `self_check` —— 模型自检口径（当前对 `/object_info` 全文做子串匹配），接 model manager 时改这一个函数。

工作流模板/参数映射由中台 `workflow_template` 下发（`/api/v1/templates`），Agent 不写死任何 prompt 或节点参数。

## 测试

```bash
pip install -r requirements.txt
python -m pytest -q
python -m compileall -q .
```

`tests/test_agent_smoke.py` 用 `fastapi.TestClient` 顶替中台并 `monkeypatch` 掉 sleep，校验：
register/heartbeat 的请求体字段与 token 头、pull 的 `node/wait` query 与 204 分支、progress→result 顺序与 mock 元数据、
fail 的四个合法错误码、`video_base64` base64 往返、参数注入同构、H3 并发=1、MOCK 模式不触网。
