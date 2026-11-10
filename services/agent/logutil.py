"""结构化 JSON 日志：一行一条，带 node_key / task_id / latency_ms；token 永不落盘。"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from typing import Any, Iterable

_LEVELS: dict[str, int] = {"debug": 10, "info": 20, "warn": 30, "warning": 30, "error": 40}
_SECRET_KEYS = {"token", "agent_token", "authorization", "x-agent-token", "password", "secret", "api_key"}

_state: dict[str, Any] = {"node_key": None, "level": "info", "secrets": ()}


def configure_logging(node_key: str | None = None, secrets: Iterable[str] = (), level: str = "info") -> None:
    """注册 node_key、需要脱敏的密钥、最低日志级别。"""
    _state["node_key"] = node_key
    _state["secrets"] = tuple(s for s in secrets if s)
    _state["level"] = (level or "info").lower()


def redact(text: str) -> str:
    """把已注册的密钥替换成 ***，防止 token 出现在任何一行日志里。"""
    out = str(text)
    for secret in _state["secrets"]:
        out = out.replace(secret, "***")
    return out


def log_event(event: str, level: str = "info", **fields: Any) -> str:
    """写一行 JSON 日志，返回该行文本（测试可直接断言）。"""
    lvl = level.lower()
    if _LEVELS.get(lvl, 20) < _LEVELS.get(_state["level"], 20):
        return ""
    record: dict[str, Any] = {
        "ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
        "level": lvl,
        "event": event,
        "node_key": _state["node_key"],
    }
    for key, value in fields.items():
        if value is None:
            continue
        record[key] = _sanitize(str(key), value)
    line = json.dumps(record, ensure_ascii=False, default=str)
    stream = sys.stderr if _LEVELS.get(lvl, 20) >= 30 else sys.stdout
    print(line, file=stream, flush=True)
    return line


def _sanitize(key: str, value: Any) -> Any:
    if key.lower() in _SECRET_KEYS:
        return "***"
    if isinstance(value, str):
        return redact(value)
    if isinstance(value, dict):
        return {str(k): _sanitize(str(k), v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_sanitize(key, item) for item in value]
    return value
