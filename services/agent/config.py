"""Agent 配置：全部来自环境变量；默认 MOCK_MODE=1，无 GPU 的机器也能跑通整条协议。

与中台 services/api/src/config.ts 的约定保持一致：
  CENTER_URL 只写 origin（例如 http://127.0.0.1:8787），/api/v1 前缀由 center.py 负责拼。
"""
from __future__ import annotations

import os
import socket
from dataclasses import dataclass

DEFAULT_ENGINE_TAGS: tuple[str, ...] = ("h3", "lipsync")
# 中台 seed 里 gpu-a 的 models_loaded：真机自检以这三个为准
DEFAULT_REQUIRED_MODELS: tuple[str, ...] = ("minimax_h3", "ipadapter_sdxl", "musetalk")


def _str(name: str, default: str) -> str:
    value = os.environ.get(name)
    return default if value is None or value.strip() == "" else value.strip()


def _int(name: str, default: int) -> int:
    try:
        return int(_str(name, str(default)))
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(_str(name, str(default)))
    except ValueError:
        return default


def _bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _list(name: str, default: tuple[str, ...] = ()) -> tuple[str, ...]:
    """支持 "h3,lipsync" / "h3 lipsync" / "h3;lipsync" 三种写法。"""
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    parts = [p.strip() for chunk in raw.replace(";", ",").split(",") for p in chunk.split()]
    return tuple(p for p in parts if p)


@dataclass(frozen=True, slots=True)
class AgentConfig:
    """不可变运行配置；所有时间单位为秒，除非字段名带 _ms。"""

    center_url: str
    agent_token: str
    node_key: str
    node_base_url: str
    engine_tags: tuple[str, ...]
    comfyui_url: str
    vram_total_gb: float
    h3_max_duration_sec: float
    mock_mode: bool
    heartbeat_interval_sec: float = 10.0
    pull_wait_sec: int = 30
    http_host: str = "0.0.0.0"
    http_port: int = 9100
    log_level: str = "info"
    required_models: tuple[str, ...] = ()
    models_loaded: tuple[str, ...] = ()
    mock_time_ratio: float = 0.25
    mock_min_sleep_ms: float = 150.0
    mock_progress_steps: int = 5
    queue_wait_sec: float = 900.0
    task_timeout_ratio: float = 40.0
    task_min_timeout_sec: float = 120.0
    ws_timeout_sec: float = 30.0


def load_config() -> AgentConfig:
    """读取一次环境变量并冻结成配置对象（进程内复用）。"""
    mock_mode = _bool("MOCK_MODE", True)
    http_port = _int("AGENT_HTTP_PORT", 9100)
    required_models = _list("AGENT_REQUIRED_MODELS", () if mock_mode else DEFAULT_REQUIRED_MODELS)
    models_loaded = _list("AGENT_MODELS", required_models)
    return AgentConfig(
        center_url=_str("CENTER_URL", "http://127.0.0.1:8787"),
        agent_token=_str("AGENT_TOKEN", "aurum-dev-agent-token"),
        node_key=_str("NODE_KEY", socket.gethostname() or "gpu-a"),
        node_base_url=_str("NODE_BASE_URL", f"http://127.0.0.1:{http_port}"),
        engine_tags=_list("ENGINE_TAGS", DEFAULT_ENGINE_TAGS),
        comfyui_url=_str("COMFYUI_URL", "http://127.0.0.1:8188"),
        vram_total_gb=_float("VRAM_TOTAL_GB", 24.0),
        h3_max_duration_sec=_float("H3_MAX_DURATION_SEC", 8.0),
        mock_mode=mock_mode,
        heartbeat_interval_sec=_float("HEARTBEAT_INTERVAL_SEC", 10.0),
        pull_wait_sec=_int("PULL_WAIT_SEC", 30),
        http_host=_str("AGENT_HTTP_HOST", "0.0.0.0"),
        http_port=http_port,
        log_level=_str("AGENT_LOG_LEVEL", "info").lower(),
        required_models=required_models,
        models_loaded=models_loaded,
        mock_time_ratio=_float("MOCK_TIME_RATIO", 0.25),
        mock_min_sleep_ms=_float("MOCK_MIN_SLEEP_MS", 150.0),
        mock_progress_steps=max(1, _int("MOCK_PROGRESS_STEPS", 5)),
        queue_wait_sec=_float("QUEUE_WAIT_SEC", 900.0),
        task_timeout_ratio=_float("TASK_TIMEOUT_RATIO", 40.0),
        task_min_timeout_sec=_float("TASK_MIN_TIMEOUT_SEC", 120.0),
        ws_timeout_sec=_float("WS_TIMEOUT_SEC", 30.0),
    )
