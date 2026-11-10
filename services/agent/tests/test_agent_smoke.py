"""Agent 协议冒烟测试：用 fastapi.TestClient 顶替真实中台，校验调用形状而不碰网络。

覆盖：
  - register / heartbeat / pull 三个请求体与 query 的字段形状、X-Agent-Token 头；
  - pull 200 有任务、204 无任务两种分支；
  - progress + result（mock 产物）与 fail（四个合法错误码）的回传；
  - video_base64 的 base64 往返；
  - workflow 参数注入与中台 injectWorkflow 同构；
  - H3 并发=1 的信号量语义、MOCK 模式不访问 ComfyUI。
"""
from __future__ import annotations

import base64
import json
from dataclasses import replace
from typing import Any

import pytest
from fastapi import FastAPI, Request, Response
from fastapi.testclient import TestClient

import agent as agent_mod
from errors import AgentError
from logutil import configure_logging, log_event
from workflow import inject_params

TASK: dict[str, Any] = {
    "task_id": 7,
    "shot_id": 3,
    "task_type": "comfy_h3",
    "workflow_template": "comfy_photoreal",
    "workflow_json": {
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": "PASTE_PROMPT"}},
        "18": {"class_type": "MinimaxH3Video", "inputs": {"prompt": "PASTE_PROMPT", "fps": 25}},
    },
    "param_map": {"prompt": {"node": "6", "field": "inputs.text"}},
    "params": {"prompt": "鎏金台开场，灯光亮起", "target_duration_ms": 4000, "seed": 42},
}


class MockCenter:
    """最小中台：记录每一次调用，供断言协议形状。"""

    def __init__(self, task: dict[str, Any] | None = None) -> None:
        self.calls: list[dict[str, Any]] = []
        self.task = task
        self.app = FastAPI(title="mock-center")
        self._mount(self.app)

    def ops(self) -> list[str]:
        return [call["op"] for call in self.calls]

    def last(self, op: str) -> dict[str, Any]:
        matched = [call for call in self.calls if call["op"] == op]
        assert matched, f"未收到 {op} 调用，实际顺序：{self.ops()}"
        return matched[-1]

    def _mount(self, api: FastAPI) -> None:
        @api.post("/api/v1/agent/register")
        async def register(payload: dict[str, Any], request: Request) -> dict[str, Any]:
            self.calls.append({"op": "register", "body": payload, "token": request.headers.get("x-agent-token")})
            return {"ok": True, "node": {"node_key": payload.get("node_key")}}

        @api.post("/api/v1/agent/heartbeat")
        async def heartbeat(payload: dict[str, Any], request: Request) -> dict[str, Any]:
            self.calls.append({"op": "heartbeat", "body": payload, "token": request.headers.get("x-agent-token")})
            return {"ok": True, "next_heartbeat_ms": 10_000}

        @api.get("/api/v1/agent/tasks/pull")
        async def pull(node: str, wait: str, request: Request) -> Any:
            self.calls.append(
                {"op": "pull", "query": {"node": node, "wait": wait}, "token": request.headers.get("x-agent-token")}
            )
            if self.task is None:
                return Response(status_code=204)
            task, self.task = self.task, None
            return task

        @api.post("/api/v1/agent/tasks/{task_id}/progress")
        async def progress(task_id: int, payload: dict[str, Any]) -> dict[str, Any]:
            self.calls.append({"op": "progress", "task_id": task_id, "body": payload})
            return {"ok": True}

        @api.post("/api/v1/agent/tasks/{task_id}/result")
        async def result(task_id: int, payload: dict[str, Any]) -> dict[str, Any]:
            self.calls.append({"op": "result", "task_id": task_id, "body": payload})
            return {"ok": True, "asset_id": 101}

        @api.post("/api/v1/agent/tasks/{task_id}/fail")
        async def fail(task_id: int, payload: dict[str, Any]) -> dict[str, Any]:
            self.calls.append({"op": "fail", "task_id": task_id, "body": payload})
            return {"ok": True}


@pytest.fixture()
def center() -> MockCenter:
    return MockCenter(dict(TASK))


def make_state(center: MockCenter, monkeypatch: pytest.MonkeyPatch, **overrides: Any) -> "agent_mod.AgentState":
    """构造指向 mock 中台的 AgentState；同时把 sleep 变成空操作让测试瞬间跑完。"""
    for name in ("AGENT_VRAM_FREE_GB", "AGENT_MODELS", "AGENT_REQUIRED_MODELS"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(agent_mod, "_sleep_until", lambda delay_ms, stop=None: None)
    cfg = replace(
        agent_mod.load_config(),
        center_url="",  # 空 base → 相对路径，交给 TestClient 解析
        agent_token="test-token",
        node_key="gpu-a",
        node_base_url="http://127.0.0.1:9100",
        engine_tags=("h3", "lipsync"),
        mock_mode=True,
        pull_wait_sec=30,
        vram_total_gb=24.0,
        models_loaded=(),
        mock_time_ratio=0.0,
        mock_min_sleep_ms=0.0,
        mock_progress_steps=3,
    )
    if overrides:
        cfg = replace(cfg, **overrides)
    return agent_mod.AgentState.from_config(cfg, http=TestClient(center.app))


# ------------------------------------------------------------------ 注册 / 心跳

def test_register_payload_shape(center: MockCenter, monkeypatch: pytest.MonkeyPatch) -> None:
    state = make_state(center, monkeypatch)
    body = agent_mod.register_once(state)

    call = center.last("register")
    assert call["token"] == "test-token"
    assert set(call["body"]) == {"node_key", "base_url", "engine_tags", "vram_total_gb", "models_loaded"}
    assert call["body"]["node_key"] == "gpu-a"
    assert call["body"]["base_url"] == "http://127.0.0.1:9100"
    assert call["body"]["engine_tags"] == ["h3", "lipsync"]
    assert isinstance(call["body"]["vram_total_gb"], float)
    assert call["body"]["models_loaded"] == []
    assert body == call["body"]


def test_heartbeat_payload_shape(center: MockCenter, monkeypatch: pytest.MonkeyPatch) -> None:
    state = make_state(center, monkeypatch)
    payload = agent_mod.heartbeat_once(state)

    call = center.last("heartbeat")
    assert call["token"] == "test-token"
    assert set(call["body"]) == {
        "node_key",
        "engine_tags",
        "vram_total_gb",
        "vram_free_gb",
        "queue_len",
        "models_loaded",
    }
    assert call["body"]["node_key"] == "gpu-a"
    assert call["body"]["queue_len"] == 0
    assert call["body"]["vram_free_gb"] == 24.0
    assert call["body"]["engine_tags"] == ["h3", "lipsync"]
    assert payload == call["body"]
    assert state.last_heartbeat_at is not None


# ------------------------------------------------------------------ 拉任务

def test_pull_returns_task_then_204(center: MockCenter, monkeypatch: pytest.MonkeyPatch) -> None:
    state = make_state(center, monkeypatch)

    task = agent_mod.pull_once(state)
    assert task is not None
    assert {"task_id", "shot_id", "task_type", "workflow_template", "workflow_json", "param_map", "params"} <= set(task)
    assert center.last("pull")["query"] == {"node": "gpu-a", "wait": "30"}
    assert center.last("pull")["token"] == "test-token"

    assert agent_mod.pull_once(state) is None  # 204 → 无任务


# ------------------------------------------------------------------ 结果 / 失败

def test_mock_task_reports_progress_and_result(center: MockCenter, monkeypatch: pytest.MonkeyPatch) -> None:
    state = make_state(center, monkeypatch)
    task = agent_mod.pull_once(state)
    assert task is not None

    summary = agent_mod.handle_task(state, task)

    assert summary["ok"] is True
    ops = center.ops()
    assert "fail" not in ops
    assert ops.count("progress") >= 1
    assert ops.index("progress") < ops.index("result")

    result = center.last("result")
    assert result["task_id"] == 7
    assert set(result["body"]) <= {"duration_ms", "video_base64", "external_id", "meta"}
    assert result["body"]["duration_ms"] == 4000
    assert result["body"]["meta"]["mock"] is True
    assert result["body"]["external_id"].startswith("mock-7-")
    assert "video_base64" not in result["body"]  # mock 只回元数据

    progresses = [call["body"]["progress"] for call in center.calls if call["op"] == "progress"]
    assert progresses == sorted(progresses)
    assert all(0 <= value <= 99 for value in progresses)


def test_result_carries_video_base64(center: MockCenter, monkeypatch: pytest.MonkeyPatch) -> None:
    state = make_state(center, monkeypatch)
    fake_mp4 = b"\x00\x00\x00\x18ftypmp42" + b"A" * 32
    monkeypatch.setattr(
        agent_mod,
        "execute_task",
        lambda st, tk, cb: {"duration_ms": 5000, "video_bytes": fake_mp4, "external_id": "pid-1", "meta": {"engine": "comfy_h3"}},
    )

    summary = agent_mod.handle_task(state, dict(TASK))

    assert summary["ok"] is True
    body = center.last("result")["body"]
    assert base64.b64decode(body["video_base64"]) == fake_mp4
    assert body["external_id"] == "pid-1"
    assert body["meta"]["engine"] == "comfy_h3"
    assert body["meta"]["agent_version"] == agent_mod.AGENT_VERSION


@pytest.mark.parametrize("code", ["OOM", "TIMEOUT", "MODEL_MISSING", "NODE_ERROR"])
def test_fail_reports_allowed_error_code(center: MockCenter, monkeypatch: pytest.MonkeyPatch, code: str) -> None:
    state = make_state(center, monkeypatch)

    def boom(st: Any, tk: Any, cb: Any) -> dict[str, Any]:
        raise AgentError(code, f"{code} 冒烟")

    monkeypatch.setattr(agent_mod, "execute_task", boom)

    summary = agent_mod.handle_task(state, dict(TASK))

    assert summary["ok"] is False
    assert summary["error_code"] == code
    assert center.last("fail")["body"]["error_code"] == code
    assert "result" not in center.ops()


def test_fail_code_is_clamped_and_message_truncated(center: MockCenter, monkeypatch: pytest.MonkeyPatch) -> None:
    state = make_state(center, monkeypatch)
    state.center.fail(7, "BOOM", "x" * 2000)

    body = center.last("fail")["body"]
    assert body["error_code"] == "NODE_ERROR"
    assert len(body["error_msg"]) <= 900


# ------------------------------------------------------------------ 执行语义

def test_mock_duration_clamped_by_h3_cap(center: MockCenter, monkeypatch: pytest.MonkeyPatch) -> None:
    state = make_state(center, monkeypatch, h3_max_duration_sec=8.0)
    task = dict(TASK)
    task["params"] = {"prompt": "x", "target_duration_ms": 20000}

    result = agent_mod._execute_mock(state, task, lambda progress, note=None: None)

    assert result["duration_ms"] == 8000
    assert result["meta"]["mock"] is True


def test_h3_concurrency_is_forced_to_one(center: MockCenter, monkeypatch: pytest.MonkeyPatch) -> None:
    state = make_state(center, monkeypatch)

    assert state.h3_semaphore.acquire(blocking=False) is True
    try:
        assert state.h3_semaphore.acquire(blocking=False) is False
    finally:
        state.h3_semaphore.release()


def test_mock_mode_never_touches_comfyui(center: MockCenter, monkeypatch: pytest.MonkeyPatch) -> None:
    state = make_state(center, monkeypatch)

    def forbidden(*args: Any, **kwargs: Any) -> None:
        raise AssertionError("MOCK_MODE 下不应访问 ComfyUI")

    monkeypatch.setattr(agent_mod.requests, "get", forbidden)
    monkeypatch.setattr(agent_mod.requests, "post", forbidden)

    assert agent_mod.self_check(state) == []
    assert state.models_ok is True
    assert agent_mod.handle_task(state, dict(TASK))["ok"] is True


def test_inject_params_matches_center_semantics() -> None:
    workflow = {"6": {"class_type": "CLIPTextEncode", "inputs": {"text": "PASTE_PROMPT"}}, "18": {"inputs": {}}}
    param_map = {
        "prompt": {"node": "6", "field": "inputs.text"},
        "fps": {"node": "18", "field": "inputs.fps"},
        "seed": {"node": "3", "field": "inputs.seed"},
    }

    injected = inject_params(workflow, param_map, {"prompt": "鎏金台", "fps": 25, "seed": 7})

    assert injected["6"]["inputs"]["text"] == "鎏金台"
    assert injected["18"]["inputs"]["fps"] == 25
    assert workflow["6"]["inputs"]["text"] == "PASTE_PROMPT"  # 原 workflow 不被改写
    assert "3" not in injected  # 节点不存在 → 跳过


# ------------------------------------------------------------------ 日志

def test_logs_are_structured_and_redacted(capsys: pytest.CaptureFixture[str]) -> None:
    configure_logging(node_key="gpu-a", secrets=("super-secret-token",), level="debug")

    line = log_event(
        "task_result",
        task_id=7,
        latency_ms=12,
        token="super-secret-token",
        note="header=X-Agent-Token super-secret-token",
    )
    payload = json.loads(line)

    assert payload["node_key"] == "gpu-a"
    assert payload["task_id"] == 7
    assert payload["latency_ms"] == 12
    assert payload["token"] == "***"
    assert "super-secret-token" not in line

    captured = capsys.readouterr()
    assert "super-secret-token" not in captured.out + captured.err


# ------------------------------------------------------------------ 自身 HTTP 面

def test_agent_health_endpoint(center: MockCenter, monkeypatch: pytest.MonkeyPatch) -> None:
    state = make_state(center, monkeypatch)
    client = TestClient(agent_mod.build_app(state))

    body = client.get("/health").json()
    assert body["ok"] is True
    assert body["node_key"] == "gpu-a"
    assert body["mock_mode"] is True
    assert body["engine_tags"] == ["h3", "lipsync"]
    assert client.get("/status").json()["running"] == 0
