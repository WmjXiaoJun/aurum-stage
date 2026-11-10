"""中台 HTTP 客户端：Agent 所有内部接口的唯一出口（token 只进请求头，不落日志）。

协议定义见 services/api/src/routes/nodes.ts：
  POST /api/v1/agent/register                body {node_key, base_url, engine_tags, vram_total_gb, models_loaded}
  POST /api/v1/agent/heartbeat               body {node_key, engine_tags, vram_total_gb, vram_free_gb, queue_len, models_loaded}
  GET  /api/v1/agent/tasks/pull?node&wait    200 = 任务 / 204 = 无任务
  POST /api/v1/agent/tasks/{id}/progress     body {progress, note}
  POST /api/v1/agent/tasks/{id}/result       body {duration_ms, video_base64?, external_id, meta}
  POST /api/v1/agent/tasks/{id}/fail         body {error_code, error_msg}
"""
from __future__ import annotations

from typing import Any

import requests

from errors import ALLOWED_ERROR_CODES

API_PREFIX = "/api/v1"


class CenterError(RuntimeError):
    """中台返回非 2xx；404 意味着节点需要重新注册。"""

    def __init__(self, status_code: int, message: str) -> None:
        self.status_code = status_code
        self.message = message
        super().__init__(f"center {status_code}: {message}")


class CenterClient:
    """可注入传输层（默认 requests.Session），便于用 fastapi.TestClient 做冒烟测试。"""

    def __init__(self, base_url: str, token: str, http: Any | None = None, timeout_sec: float = 60.0) -> None:
        self.base_url = (base_url or "").strip().rstrip("/")
        self.token = token
        self.timeout_sec = timeout_sec
        self._http: Any = http if http is not None else requests.Session()

    # ------------------------------------------------------------------ 协议方法
    def register(
        self,
        *,
        node_key: str,
        base_url: str,
        engine_tags: list[str],
        vram_total_gb: float,
        models_loaded: list[str],
    ) -> dict[str, Any]:
        """注册/覆盖节点（中台 INSERT OR REPLACE）。"""
        return self._request(
            "POST",
            "/agent/register",
            body={
                "node_key": node_key,
                "base_url": base_url,
                "engine_tags": engine_tags,
                "vram_total_gb": vram_total_gb,
                "models_loaded": models_loaded,
            },
        ) or {}

    def heartbeat(self, payload: dict[str, Any]) -> dict[str, Any]:
        """心跳：10s 一次，载荷由调用方组好。"""
        return self._request("POST", "/agent/heartbeat", body=payload) or {}

    def pull(self, node_key: str, wait_sec: int) -> dict[str, Any] | None:
        """长轮询拉任务；204 返回 None。"""
        wait = max(1, min(30, int(wait_sec)))
        return self._request(
            "GET",
            "/agent/tasks/pull",
            params={"node": node_key, "wait": wait},
            timeout=float(wait + 20),
        )

    def progress(self, task_id: int, progress: int, note: str | None = None) -> dict[str, Any]:
        """进度回传（0-100）。"""
        return self._request(
            "POST",
            f"/agent/tasks/{int(task_id)}/progress",
            body={"progress": max(0, min(100, int(progress))), "note": note},
        ) or {}

    def result(
        self,
        task_id: int,
        *,
        duration_ms: int,
        video_base64: str | None = None,
        external_id: str | None = None,
        meta: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """产物回传；video_base64 可选（中台会直接落盘并登记 asset）。"""
        body: dict[str, Any] = {"duration_ms": int(duration_ms or 0)}
        if video_base64:
            body["video_base64"] = video_base64
        if external_id:
            body["external_id"] = str(external_id)
        body["meta"] = dict(meta or {})
        return self._request("POST", f"/agent/tasks/{int(task_id)}/result", body=body) or {}

    def fail(self, task_id: int, error_code: str, error_msg: str) -> dict[str, Any]:
        """失败回传；error_code 越界时收敛成 NODE_ERROR（中台只接受四个值）。"""
        code = error_code if error_code in ALLOWED_ERROR_CODES else "NODE_ERROR"
        message = " ".join(str(error_msg or code).split())[:900]
        return self._request(
            "POST",
            f"/agent/tasks/{int(task_id)}/fail",
            body={"error_code": code, "error_msg": message},
        ) or {}

    # ------------------------------------------------------------------ 传输细节
    def _headers(self) -> dict[str, str]:
        return {"Content-Type": "application/json", "X-Agent-Token": self.token}

    def _url(self, path: str) -> str:
        """CENTER_URL 三种写法都兼容：origin / origin/api / origin/api/v1。"""
        base = self.base_url
        if base.endswith(API_PREFIX):
            return base + path
        if base.endswith("/api"):
            return base + "/v1" + path
        return base + API_PREFIX + path

    def _request(
        self,
        method: str,
        path: str,
        *,
        body: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
        timeout: float | None = None,
    ) -> Any:
        kwargs: dict[str, Any] = {
            "headers": self._headers(),
            "timeout": self.timeout_sec if timeout is None else timeout,
        }
        if body is not None:
            kwargs["json"] = body
        if params is not None:
            kwargs["params"] = params
        response = self._http.request(method, self._url(path), **kwargs)
        status = int(getattr(response, "status_code", 0))
        if status >= 400:
            raise CenterError(status, _text(response))
        if status == 204:
            return None
        try:
            return response.json()
        except Exception:
            return None


def _text(response: Any) -> str:
    try:
        return " ".join(str(response.text).split())[:400]
    except Exception:
        return ""
