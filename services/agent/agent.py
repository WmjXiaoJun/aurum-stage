"""鎏金台 AURUM STAGE · GPU 侧 ComfyUI Agent（Python 3.11+）。

职责链路：
    注册节点 → 心跳线程（10s，绝不阻塞） → 长轮询拉任务 → 注入 params 到 workflow_json
    → POST ComfyUI /prompt → websocket /ws 监听进度回传 → 取 mp4 产物 → 回传 result / fail

协议（与 services/api/src/routes/nodes.ts 对齐，鉴权头 X-Agent-Token）：
    POST {CENTER_URL}/api/v1/agent/register
    POST {CENTER_URL}/api/v1/agent/heartbeat
    GET  {CENTER_URL}/api/v1/agent/tasks/pull?node=&wait=     200 任务 / 204 无任务
    POST {CENTER_URL}/api/v1/agent/tasks/{id}/progress
    POST {CENTER_URL}/api/v1/agent/tasks/{id}/result
    POST {CENTER_URL}/api/v1/agent/tasks/{id}/fail            error_code ∈ OOM|NODE_ERROR|TIMEOUT|MODEL_MISSING

接真实 ComfyUI 时要改的地方：全文搜 "TODO(真实 ComfyUI"，共 4 处。
"""
from __future__ import annotations

import base64
import json
import os
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable

import requests
from fastapi import FastAPI

try:  # websocket-client：只有真跑 ComfyUI 才需要，缺依赖不影响 MOCK_MODE
    import websocket as _ws
except ModuleNotFoundError:  # pragma: no cover - mock 模式下走不到
    _ws = None  # type: ignore[assignment]

from center import CenterClient, CenterError
from config import AgentConfig, load_config
from errors import AgentError, TaskTimeout, classify_exception, classify_text
from logutil import configure_logging, log_event
from workflow import inject_params

ProgressFn = Callable[[int, str | None], None]

# ComfyUI 产物字段白名单（见 TODO(真实 ComfyUI #2)）
_VIDEO_EXTS: tuple[str, ...] = ("mp4", "webm", "mov", "mkv", "gif", "webp")


# ============================================================ 运行时状态

@dataclass
class AgentState:
    """进程内共享状态：并发槽、在途任务、停止信号。"""

    cfg: AgentConfig
    center: CenterClient
    h3_semaphore: threading.Semaphore = field(default_factory=lambda: threading.Semaphore(1))
    lipsync_semaphore: threading.Semaphore = field(default_factory=lambda: threading.Semaphore(1))
    stop: threading.Event = field(default_factory=threading.Event)
    lock: threading.Lock = field(default_factory=threading.Lock)
    client_id: str = field(default_factory=lambda: uuid.uuid4().hex)
    models_ok: bool = True
    missing_models: list[str] = field(default_factory=list)
    last_heartbeat_at: float | None = None
    _running: dict[int, str] = field(default_factory=dict)

    @classmethod
    def from_config(cls, cfg: AgentConfig, http: Any | None = None) -> "AgentState":
        """按配置建状态；http 可注入 TestClient 之类替代传输层。"""
        return cls(cfg=cfg, center=CenterClient(cfg.center_url, cfg.agent_token, http=http))

    def mark_running(self, task_id: int, task_type: str) -> None:
        with self.lock:
            self._running[task_id] = task_type

    def mark_done(self, task_id: int) -> None:
        with self.lock:
            self._running.pop(task_id, None)

    def queue_len(self) -> int:
        """在途任务数；H3 并发=1，所以它约等于排队长度。"""
        with self.lock:
            return len(self._running)

    def models_loaded(self) -> list[str]:
        return list(self.cfg.models_loaded)

    def vram_free_gb(self) -> float:
        """心跳上报的显存余量：环境变量优先 → ComfyUI /system_stats → 退回总显存。"""
        raw = os.environ.get("AGENT_VRAM_FREE_GB", "").strip()
        if raw:
            try:
                return round(float(raw), 2)
            except ValueError:
                pass
        if not self.cfg.mock_mode:
            try:
                res = requests.get(_comfy_base(self) + "/system_stats", timeout=(2, 4))
                devices = (res.json() or {}).get("devices") or []
                if devices:
                    total = float(devices[0].get("vram_total") or 0)
                    free = float(devices[0].get("vram_free") or 0)
                    if total > 0:
                        return round(free / (1024 ** 3), 2)
            except Exception:
                pass
        return round(self.cfg.vram_total_gb, 2)

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            tasks = dict(self._running)
        return {
            "node_key": self.cfg.node_key,
            "mock_mode": self.cfg.mock_mode,
            "engine_tags": list(self.cfg.engine_tags),
            "comfyui_url": self.cfg.comfyui_url,
            "running": len(tasks),
            "tasks": [{"task_id": tid, "task_type": ttype} for tid, ttype in sorted(tasks.items())],
            "models_ok": self.models_ok,
            "last_heartbeat_at": self.last_heartbeat_at,
        }


# ============================================================ 注册 / 心跳

def register_once(state: AgentState) -> dict[str, Any]:
    """注册（或覆盖）节点信息，返回实际发送的 body（便于断言协议形状）。"""
    body: dict[str, Any] = {
        "node_key": state.cfg.node_key,
        "base_url": state.cfg.node_base_url,
        "engine_tags": list(state.cfg.engine_tags),
        "vram_total_gb": round(state.cfg.vram_total_gb, 2),
        "models_loaded": state.models_loaded(),
    }
    state.center.register(
        node_key=body["node_key"],
        base_url=body["base_url"],
        engine_tags=body["engine_tags"],
        vram_total_gb=body["vram_total_gb"],
        models_loaded=body["models_loaded"],
    )
    log_event("node_registered", node_key=state.cfg.node_key, base_url=body["base_url"], engine_tags=body["engine_tags"], vram_total_gb=body["vram_total_gb"])
    return body


def register_with_retry(state: AgentState, attempts: int = 5, delay_sec: float = 3.0) -> bool:
    """启动时注册；中台还没起来时按退避重试，不阻塞心跳启动。"""
    for attempt in range(1, attempts + 1):
        try:
            register_once(state)
            return True
        except Exception as exc:
            log_event("node_register_failed", level="warn", attempt=attempt, attempts=attempts, error=_short(exc))
            if attempt < attempts:
                state.stop.wait(delay_sec * attempt)
    return False


def build_heartbeat_payload(state: AgentState) -> dict[str, Any]:
    """心跳载荷：字段与中台 nodes.ts 的 /agent/heartbeat 完全对齐。"""
    return {
        "node_key": state.cfg.node_key,
        "engine_tags": list(state.cfg.engine_tags),
        "vram_total_gb": round(state.cfg.vram_total_gb, 2),
        "vram_free_gb": state.vram_free_gb(),
        "queue_len": state.queue_len(),
        "models_loaded": state.models_loaded(),
    }


def heartbeat_once(state: AgentState) -> dict[str, Any]:
    """发一次心跳并记录时间戳。"""
    payload = build_heartbeat_payload(state)
    state.center.heartbeat(payload)
    state.last_heartbeat_at = time.time()
    log_event("heartbeat", node_key=state.cfg.node_key, queue_len=payload["queue_len"], vram_free_gb=payload["vram_free_gb"], vram_total_gb=payload["vram_total_gb"])
    return payload


def heartbeat_loop(state: AgentState) -> None:
    """独立心跳线程：只做 HTTP 心跳，不等任务槽，长任务不会把节点打成离线。"""
    interval = max(1.0, state.cfg.heartbeat_interval_sec)
    while not state.stop.is_set():
        try:
            heartbeat_once(state)
        except Exception as exc:
            log_event("heartbeat_failed", level="warn", node_key=state.cfg.node_key, error=_short(exc))
        state.stop.wait(interval)


# ============================================================ 拉任务

def pull_once(state: AgentState) -> dict[str, Any] | None:
    """拉一次任务：200 返回任务 dict，204（无任务）返回 None。"""
    task = state.center.pull(state.cfg.node_key, state.cfg.pull_wait_sec)
    if task is None:
        log_event("pull_empty", level="debug", node_key=state.cfg.node_key, wait_sec=state.cfg.pull_wait_sec)
        return None
    log_event(
        "task_pulled",
        node_key=state.cfg.node_key,
        task_id=_as_int(task.get("task_id")),
        shot_id=_as_int(task.get("shot_id")),
        task_type=task.get("task_type"),
        workflow_template=task.get("workflow_template"),
    )
    return task


def pull_loop(state: AgentState) -> None:
    """长轮询主循环：拿到任务就起线程执行，主循环立刻回去拉下一个。"""
    while not state.stop.is_set():
        try:
            task = pull_once(state)
        except CenterError as exc:
            # 404 = 节点未注册（中台重启/掉库），重新注册后继续
            if exc.status_code == 404:
                log_event("pull_not_registered", level="warn", node_key=state.cfg.node_key, error=exc.message[:200])
                try:
                    register_once(state)
                except Exception as reg_exc:
                    log_event("node_register_failed", level="warn", node_key=state.cfg.node_key, error=_short(reg_exc))
                    state.stop.wait(5.0)
            else:
                log_event("pull_failed", level="warn", node_key=state.cfg.node_key, status=exc.status_code, error=exc.message[:200])
                state.stop.wait(5.0)
            continue
        except Exception as exc:
            log_event("pull_failed", level="warn", node_key=state.cfg.node_key, error=_short(exc))
            state.stop.wait(5.0)
            continue
        if task is None:
            continue
        task_id = _as_int(task.get("task_id"))
        threading.Thread(target=handle_task, args=(state, task), name=f"aurum-task-{task_id}", daemon=True).start()


# ============================================================ 任务执行

def handle_task(state: AgentState, task: dict[str, Any]) -> dict[str, Any]:
    """执行一个任务并把进度 / 结果 / 失败按协议回传；返回摘要（测试直接断言）。"""
    task_id = _as_int(task.get("task_id"))
    task_type = str(task.get("task_type") or "")
    if task_id <= 0:
        log_event("task_skipped", level="warn", node_key=state.cfg.node_key, reason="缺少 task_id")
        return {"task_id": task_id, "ok": False, "error_code": "NODE_ERROR"}

    started = time.monotonic()
    state.mark_running(task_id, task_type)
    log_event("task_start", node_key=state.cfg.node_key, task_id=task_id, task_type=task_type, shot_id=_as_int(task.get("shot_id")))
    progress_state = {"last": -1}

    def on_progress(progress: int, note: str | None = None) -> None:
        """节流回传进度（最小步进 5），避免 1% 一条把中台打满。"""
        value = max(0, min(99, int(progress)))
        if value - progress_state["last"] < 5:
            return
        progress_state["last"] = value
        try:
            state.center.progress(task_id, value, note)
        except Exception as exc:
            log_event("progress_failed", level="warn", node_key=state.cfg.node_key, task_id=task_id, error=_short(exc))

    try:
        if not state.models_ok:
            raise AgentError("MODEL_MISSING", "启动自检缺模型：" + (",".join(state.missing_models) or "未知"))
        result = execute_task(state, task, on_progress)
        video_bytes = result.get("video_bytes") or b""
        video_b64 = base64.b64encode(video_bytes).decode("ascii") if video_bytes else None
        meta = dict(result.get("meta") or {})
        meta.setdefault("agent_version", AGENT_VERSION)
        response = state.center.result(
            task_id,
            duration_ms=_as_int(result.get("duration_ms")),
            video_base64=video_b64,
            external_id=result.get("external_id"),
            meta=meta,
        )
        log_event(
            "task_result",
            node_key=state.cfg.node_key,
            task_id=task_id,
            task_type=task_type,
            latency_ms=int((time.monotonic() - started) * 1000),
            duration_ms=_as_int(result.get("duration_ms")),
            video_bytes=len(video_bytes),
            mock=bool(meta.get("mock")),
            asset_id=response.get("asset_id"),
        )
        return {"task_id": task_id, "ok": True, "result": response, "video_bytes": len(video_bytes)}
    except Exception as exc:
        err = classify_exception(exc)
        try:
            state.center.fail(task_id, err.code, err.message)
        except Exception as fail_exc:
            log_event("fail_report_failed", level="error", node_key=state.cfg.node_key, task_id=task_id, error=_short(fail_exc))
        log_event(
            "task_failed",
            level="error",
            node_key=state.cfg.node_key,
            task_id=task_id,
            task_type=task_type,
            error_code=err.code,
            error_msg=err.message,
            latency_ms=int((time.monotonic() - started) * 1000),
        )
        return {"task_id": task_id, "ok": False, "error_code": err.code}
    finally:
        state.mark_done(task_id)


def execute_task(state: AgentState, task: dict[str, Any], on_progress: ProgressFn) -> dict[str, Any]:
    """按并发策略执行：H3 单机并发强制 = 1（信号量），lipsync 用另一个单槽。"""
    task_type = str(task.get("task_type") or "comfy_h3")
    semaphore = state.h3_semaphore if task_type == "comfy_h3" else state.lipsync_semaphore
    if not semaphore.acquire(timeout=state.cfg.queue_wait_sec):
        raise TaskTimeout(f"等待本机执行槽超时（{state.cfg.queue_wait_sec:.0f}s）")
    try:
        if state.cfg.mock_mode:
            return _execute_mock(state, task, on_progress)
        return _execute_comfy(state, task, on_progress)
    finally:
        semaphore.release()


def _execute_mock(state: AgentState, task: dict[str, Any], on_progress: ProgressFn) -> dict[str, Any]:
    """MOCK_MODE：不连 ComfyUI，按 target_duration_ms 线性 sleep（上限 H3_MAX_DURATION_SEC），只回元数据。"""
    params = dict(task.get("params") or {})
    task_id = _as_int(task.get("task_id"))
    cap_ms = state.cfg.h3_max_duration_sec * 1000.0
    target_ms = _as_float(params.get("target_duration_ms") or params.get("duration_ms"), 3000.0)
    duration_ms = int(min(cap_ms, max(400.0, target_ms)))
    sleep_ms = int(min(cap_ms, max(state.cfg.mock_min_sleep_ms, duration_ms * state.cfg.mock_time_ratio)))
    steps = max(1, state.cfg.mock_progress_steps)
    log_event("mock_start", node_key=state.cfg.node_key, task_id=task_id, duration_ms=duration_ms, mock_sleep_ms=sleep_ms)
    for index in range(1, steps + 1):
        _sleep_until(sleep_ms / steps, state.stop)
        on_progress(int(index * 90 / steps), f"mock 合成 {index}/{steps}")
    return {
        "duration_ms": duration_ms,
        "video_bytes": b"",
        "external_id": f"mock-{task_id}-{uuid.uuid4().hex[:8]}",
        "meta": {
            "mock": True,
            "mock_sleep_ms": sleep_ms,
            "workflow_template": task.get("workflow_template"),
            "engine": "mock",
        },
    }


def _execute_comfy(state: AgentState, task: dict[str, Any], on_progress: ProgressFn) -> dict[str, Any]:
    """真实链路：注入 params → POST /prompt → 监听 /ws → 取产物。"""
    cfg = state.cfg
    task_id = _as_int(task.get("task_id"))
    task_type = str(task.get("task_type") or "comfy_h3")
    params = dict(task.get("params") or {})
    workflow = inject_params(dict(task.get("workflow_json") or {}), dict(task.get("param_map") or {}), params)
    if not workflow:
        raise AgentError("NODE_ERROR", "workflow_json 为空，无法提交 ComfyUI")

    duration_ms = _clamp_duration_ms(state, params)
    _check_vram(state, duration_ms)
    deadline = time.monotonic() + _task_timeout_sec(cfg, duration_ms)

    prompt_id = comfy_submit(state, workflow)
    on_progress(10, f"已提交 ComfyUI prompt_id={prompt_id}")
    comfy_watch_progress(state, prompt_id, on_progress, deadline)
    on_progress(88, "开始取产物")
    blob = comfy_fetch_output(state, prompt_id, deadline)
    if not blob:
        log_event("output_missing", level="warn", node_key=cfg.node_key, task_id=task_id, prompt_id=prompt_id)

    return {
        "duration_ms": duration_ms,
        "video_bytes": blob or b"",
        "external_id": prompt_id,
        "meta": {
            "mock": False,
            "engine": "comfy_h3" if task_type == "comfy_h3" else "lipsync",
            "comfyui_url": cfg.comfyui_url,
            "prompt_id": prompt_id,
            "workflow_template": task.get("workflow_template"),
            "output_bytes": len(blob or b""),
        },
    }


# ============================================================ ComfyUI 接入

def comfy_submit(state: AgentState, workflow: dict[str, Any]) -> str:
    """POST /prompt 提交工作流，返回 prompt_id。

    TODO(真实 ComfyUI #1)（鉴权 / 反代 / 接口形态）：
        - ComfyUI 前置了 nginx Basic Auth 或网关鉴权时，改 _comfy_headers()，不要在这里硬编码。
        - 自定义节点版本差异（例如 H3 节点需要额外 required 字段）请改 workflow 模板或 param_map，
          让中台 /api/v1/templates 下发，别在 Agent 里写死参数。
        - 若你的 ComfyUI 用 /api/prompt（离屏模式）或需要 client_id 绑定 ws，改这一行的 URL 与 body。
    """
    url = _comfy_base(state) + "/prompt"
    payload = {"prompt": workflow, "client_id": state.client_id}
    try:
        response = requests.post(url, json=payload, headers=_comfy_headers(state), timeout=(5, 30))
    except requests.RequestException as exc:
        raise AgentError("NODE_ERROR", f"ComfyUI 不可达（{url}）：{_short(exc)}") from exc

    text = _short(response.text)
    if response.status_code >= 400:
        raise AgentError(classify_text(text), f"ComfyUI /prompt 返回 {response.status_code}：{text}")
    try:
        data = response.json()
    except ValueError:
        raise AgentError("NODE_ERROR", f"ComfyUI /prompt 返回非 JSON：{text}") from None
    if isinstance(data, dict) and data.get("error"):
        raise AgentError(classify_text(json.dumps(data, ensure_ascii=False)), f"ComfyUI 拒绝 workflow：{_short(data.get('error'))}")
    if isinstance(data, dict) and data.get("node_errors"):
        raise AgentError("NODE_ERROR", f"ComfyUI 节点校验失败：{_short(data.get('node_errors'))}")
    prompt_id = data.get("prompt_id") if isinstance(data, dict) else None
    if not prompt_id:
        raise AgentError("NODE_ERROR", f"ComfyUI 未返回 prompt_id：{text}")
    return str(prompt_id)


def comfy_watch_progress(state: AgentState, prompt_id: str, on_progress: ProgressFn, deadline: float) -> None:
    """监听 ComfyUI /ws：progress 消息映射到 12..86，靠 /history 判定完成。

    TODO(真实 ComfyUI #3)（进度与完成判定）：
        - 默认认 "progress" / "executing(node=None)" / /history 出现条目三种完成信号；
          换成 ComfyUI 新版 messages API 时，在这里补 event 名即可。
        - 需要更细的分段进度（多 sampler 串联）可在 "executing" 里按节点序号插值。
    """
    if _ws is None:
        raise AgentError("NODE_ERROR", "缺少 websocket-client 依赖：pip install websocket-client")
    ws_url = _comfy_ws_url(state)
    try:
        connection = _ws.create_connection(ws_url, timeout=state.cfg.ws_timeout_sec)
    except Exception as exc:
        raise AgentError("NODE_ERROR", f"ComfyUI websocket 连接失败（{ws_url}）：{_short(exc)}") from exc

    try:
        while True:
            if time.monotonic() > deadline:
                raise TaskTimeout(f"等待 ComfyUI 执行超时（prompt_id={prompt_id}）")
            try:
                raw = connection.recv()
            except Exception as exc:  # 超时只是这段时间没消息，交给 /history 与 deadline 兜底
                if "Timeout" in type(exc).__name__:
                    raw = None
                else:
                    raise AgentError("NODE_ERROR", f"ComfyUI websocket 断开：{_short(exc)}") from exc
            if isinstance(raw, str) and raw:
                if _handle_ws_message(raw, prompt_id, on_progress):
                    return
            entry = _history_entry(state, prompt_id)
            if entry is not None:
                if str((entry.get("status") or {}).get("status_str") or "") == "error":
                    raise AgentError("NODE_ERROR", f"ComfyUI 执行出错：{_short(entry.get('status'))}")
                on_progress(86, "ComfyUI 执行完成")
                return
            if raw is None:
                _sleep_until(500.0, state.stop)
    finally:
        try:
            connection.close()
        except Exception:
            pass


def _handle_ws_message(raw: str, prompt_id: str, on_progress: ProgressFn) -> bool:
    """解析一条 /ws 文本消息；返回 True 表示已确认执行结束。"""
    try:
        message = json.loads(raw)
    except ValueError:
        return False
    if not isinstance(message, dict):
        return False
    mtype = str(message.get("type") or "")
    data = message.get("data") if isinstance(message.get("data"), dict) else {}

    if mtype == "progress":
        value = _as_float(data.get("value"), 0.0)
        total = max(1.0, _as_float(data.get("max"), 1.0))
        on_progress(12 + int(round(72 * min(1.0, value / total))), f"采样 {int(value)}/{int(total)}")
        return False
    if mtype in {"executing", "executed"}:
        if data.get("prompt_id") in (None, prompt_id) and data.get("node") is None:
            on_progress(86, "ComfyUI 执行完成")
            return True
        return False
    if mtype == "execution_error":
        raise AgentError(classify_text(json.dumps(data, ensure_ascii=False)), f"ComfyUI 执行错误：{_short(data)}")
    if mtype == "execution_interrupted":
        raise AgentError("NODE_ERROR", "ComfyUI 执行被中断（interrupt）")
    return False


def comfy_fetch_output(state: AgentState, prompt_id: str, deadline: float) -> bytes | None:
    """从 /history 找视频产物并 /view 下载；取不到返回 None（只回传元数据）。

    TODO(真实 ComfyUI #2)（产物类型与下载方式）：
        - 默认覆盖 SaveVideo / SaveWEBM / VHS_VideoCombine 的 videos|gifs|images 字段；
          换自定义保存节点（SaveAnimatedWEBP / SaveAudio）时改 _VIDEO_EXTS 与字段名。
        - 若 ComfyUI 与 Agent 同机，也可以直接读 output 目录，省掉一次 HTTP 往返。
    """
    entry = _history_entry(state, prompt_id)
    while entry is None and time.monotonic() < deadline:
        _sleep_until(500.0, state.stop)
        entry = _history_entry(state, prompt_id)
    if entry is None:
        return None

    for node_output in (entry.get("outputs") or {}).values():
        if not isinstance(node_output, dict):
            continue
        for field_name in ("videos", "gifs", "images", "video", "audio"):
            items = node_output.get(field_name)
            if not isinstance(items, list):
                continue
            for item in items:
                if not isinstance(item, dict):
                    continue
                filename = str(item.get("filename") or "")
                if not filename.lower().endswith(_VIDEO_EXTS):
                    continue
                blob = _comfy_view(state, item)
                if blob:
                    return blob
    return None


def _comfy_view(state: AgentState, item: dict[str, Any]) -> bytes | None:
    """GET /view 下载单个产物。"""
    params = {
        "filename": item.get("filename", ""),
        "subfolder": item.get("subfolder", ""),
        "type": item.get("type", "output"),
    }
    try:
        response = requests.get(_comfy_base(state) + "/view", params=params, headers=_comfy_headers(state), timeout=(5, 120))
    except requests.RequestException:
        return None
    if response.status_code >= 400 or not response.content:
        return None
    return response.content


def _history_entry(state: AgentState, prompt_id: str) -> dict[str, Any] | None:
    """查询 /history/{prompt_id}：有条目即已完成（ComfyUI 完成才写入历史）。"""
    try:
        response = requests.get(
            _comfy_base(state) + f"/history/{prompt_id}",
            headers=_comfy_headers(state),
            timeout=(3, 15),
        )
        if response.status_code >= 400:
            return None
        data = response.json() or {}
    except Exception:
        return None
    entry = data.get(prompt_id) if isinstance(data, dict) else None
    return entry if isinstance(entry, dict) else None


def _comfy_base(state: AgentState) -> str:
    return state.cfg.comfyui_url.rstrip("/")


def _comfy_headers(state: AgentState) -> dict[str, str]:
    """ComfyUI 请求头；TODO(真实 ComfyUI #1) 里提到的鉴权也在这里加。"""
    headers = {"Content-Type": "application/json"}
    token = os.environ.get("COMFYUI_API_KEY", "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _comfy_ws_url(state: AgentState) -> str:
    """http(s)://host:8188 → ws(s)://host:8188/ws?clientId=..."""
    base = _comfy_base(state)
    if base.startswith("https://"):
        ws_base = "wss://" + base[len("https://"):]
    elif base.startswith("http://"):
        ws_base = "ws://" + base[len("http://"):]
    elif base.startswith(("ws://", "wss://")):
        ws_base = base
    else:
        ws_base = "ws://" + base
    return f"{ws_base}/ws?clientId={state.client_id}"


# ============================================================ 自检 / 限流 / 工具

def self_check(state: AgentState) -> list[str]:
    """启动自检：ComfyUI 可达性 + 必需模型是否存在；缺模型置 models_ok=False 并打 MODEL_MISSING 日志。

    TODO(真实 ComfyUI #4)（模型自检口径）：
        - 当前用 AGENT_REQUIRED_MODELS 在 /object_info 全文里做子串匹配，兼容性最好但比较粗；
          接自建 model manager / 对象存储时，把这个函数换成真实查询（保持返回缺失清单即可）。
    """
    cfg = state.cfg
    if cfg.mock_mode:
        state.models_ok = True
        state.missing_models = []
        log_event("self_check_ok", node_key=cfg.node_key, mock=True, comfyui_url=cfg.comfyui_url)
        return []
    if not cfg.required_models:
        log_event("self_check_skipped", node_key=cfg.node_key, reason="AGENT_REQUIRED_MODELS 为空")
        return []

    try:
        response = requests.get(_comfy_base(state) + "/object_info", headers=_comfy_headers(state), timeout=(5, 30))
        response.raise_for_status()
        catalog = response.text
    except Exception as exc:
        # 引擎不可达不算缺模型：任务会在提交时报 NODE_ERROR
        log_event("self_check_comfy_unreachable", level="error", node_key=cfg.node_key, error_code="NODE_ERROR", error=_short(exc))
        return []

    missing = [name for name in cfg.required_models if name not in catalog]
    state.missing_models = missing
    state.models_ok = not missing
    if missing:
        log_event("self_check_model_missing", level="error", node_key=cfg.node_key, error_code="MODEL_MISSING", missing_models=missing, comfyui_url=cfg.comfyui_url)
    else:
        log_event("self_check_ok", node_key=cfg.node_key, models=list(cfg.required_models))
    return missing


def _clamp_duration_ms(state: AgentState, params: dict[str, Any]) -> int:
    """把请求时长收进 H3_MAX_DURATION_SEC（默认 8s）；超出则夹断并记一条 warn。"""
    cap_ms = int(state.cfg.h3_max_duration_sec * 1000)
    requested = _as_float(params.get("target_duration_ms") or params.get("duration_ms"), float(cap_ms))
    if requested <= 0:
        requested = float(cap_ms)
    if requested > cap_ms:
        log_event("duration_clamped", level="warn", node_key=state.cfg.node_key, requested_ms=int(requested), capped_ms=cap_ms)
        return cap_ms
    return int(requested)


def _required_vram_gb(duration_ms: float) -> float:
    """粗估 H3 峰值显存：2GB 基座 + 每秒约 2GB（8s 片段 ≈ 18GB），只用于开工前拦一刀。"""
    return 2.0 + 2.0 * (duration_ms / 1000.0)


def _check_vram(state: AgentState, duration_ms: float) -> None:
    """显存预检：明显不够就 OOM，别把无谓的失败丢给 ComfyUI。"""
    free = state.vram_free_gb()
    need = _required_vram_gb(duration_ms)
    if free > 0 and need > free + 1.5:
        raise AgentError("OOM", f"显存预估不足：需要约 {need:.1f}GB，当前剩余 {free:.1f}GB")


def _task_timeout_sec(cfg: AgentConfig, duration_ms: float) -> float:
    """整体超时：H3 真实耗时 ≈ 时长 × 20~40 倍，超时按 TIMEOUT 回传。"""
    return max(cfg.task_min_timeout_sec, duration_ms / 1000.0 * cfg.task_timeout_ratio)


def _sleep_until(delay_ms: float, stop: threading.Event | None = None) -> None:
    """可中断睡眠（测试里 monkeypatch 掉即可不等待）。"""
    seconds = max(0.0, delay_ms / 1000.0)
    if stop is not None:
        stop.wait(seconds)
    else:
        time.sleep(seconds)


def _as_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _as_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _short(value: Any, limit: int = 300) -> str:
    """把任意对象压成一行短文本，日志/错误信息都用它，避免刷屏。"""
    if isinstance(value, str):
        text = value
    else:
        try:
            text = json.dumps(value, ensure_ascii=False, default=str)
        except Exception:
            text = str(value)
    return " ".join(text.split())[:limit]


# ============================================================ HTTP 面 / 启动

AGENT_VERSION = "1.0.0"


def build_app(state: AgentState | None = None) -> FastAPI:
    """Agent 自身的 HTTP 面：/health 给 K8s/Docker 探活，/status 给运维看队列。"""
    agent_state = state or AgentState.from_config(load_config())
    api = FastAPI(
        title="Aurum Stage · GPU ComfyUI Agent",
        version=AGENT_VERSION,
        description="鎏金台 GPU 节点代理：注册 / 心跳 / 长轮询 / ComfyUI 执行（协议见 README）",
    )

    @api.get("/health")
    def health() -> dict[str, Any]:
        return {
            "ok": True,
            "node_key": agent_state.cfg.node_key,
            "mock_mode": agent_state.cfg.mock_mode,
            "comfyui_url": agent_state.cfg.comfyui_url,
            "engine_tags": list(agent_state.cfg.engine_tags),
            "running": agent_state.queue_len(),
            "models_ok": agent_state.models_ok,
        }

    @api.get("/status")
    def status() -> dict[str, Any]:
        snapshot = agent_state.snapshot()
        snapshot["vram_total_gb"] = round(agent_state.cfg.vram_total_gb, 2)
        snapshot["vram_free_gb"] = agent_state.vram_free_gb()
        snapshot["missing_models"] = list(agent_state.missing_models)
        snapshot["h3_slots_free"] = 1 if agent_state.h3_semaphore.acquire(blocking=False) else 0
        if snapshot["h3_slots_free"] == 1:
            agent_state.h3_semaphore.release()
        return snapshot

    return api


app = build_app()


def main() -> None:
    """进程入口：注册 → 自检 → 心跳线程 + 拉任务线程 + 自身 HTTP 面。"""
    import uvicorn

    cfg = load_config()
    configure_logging(node_key=cfg.node_key, secrets=(cfg.agent_token,), level=cfg.log_level)
    state = AgentState.from_config(cfg)
    log_event(
        "agent_boot",
        mock_mode=cfg.mock_mode,
        engine_tags=list(cfg.engine_tags),
        comfyui_url=cfg.comfyui_url,
        center_url=cfg.center_url,
        vram_total_gb=cfg.vram_total_gb,
        h3_max_duration_sec=cfg.h3_max_duration_sec,
        version=AGENT_VERSION,
    )
    if not register_with_retry(state):
        log_event("node_register_given_up", level="error", error="中台多次不可达，拉任务循环会继续重试")
    self_check(state)
    threading.Thread(target=heartbeat_loop, args=(state,), name="aurum-heartbeat", daemon=True).start()
    threading.Thread(target=pull_loop, args=(state,), name="aurum-puller", daemon=True).start()
    try:
        uvicorn.run(build_app(state), host=cfg.http_host, port=cfg.http_port, log_level="warning")
    finally:
        state.stop.set()
        log_event("agent_shutdown")


if __name__ == "__main__":
    main()
