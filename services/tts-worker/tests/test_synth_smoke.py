"""TTS Worker 冒烟测试：/health 与 /synth 的响应形状、静音 WAV 合法性、时间戳覆盖整段时长。

只依赖 fastapi / httpx / pytest；不需要安装 IndexTTS-2（自动走静音占位降级）。
"""
from __future__ import annotations

import base64

import pytest
from fastapi.testclient import TestClient

from tts_worker import MAX_DURATION_MS, app
from wav_util import SAMPLE_RATE, estimate_duration_ms, parse_wav_header

client = TestClient(app)


def test_health_shape() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["engine"] == "indextts2"
    assert body["loaded"] is False
    assert body["mode"] == "mock"


def test_synth_returns_valid_silence_wav() -> None:
    response = client.post(
        "/synth",
        json={
            "text": "鎏金台开场，灯光亮起。",
            "voice_id": "v_host",
            "emotion_instruction": "温暖稳重，略带笑意",
            "speed": 1.0,
            "ref_audio_paths": ["/refs/host_01.wav"],
        },
    )
    assert response.status_code == 200
    body = response.json()

    assert {"wav_base64", "duration_ms", "word_timestamps", "engine"} <= set(body)
    assert body["engine"] == "indextts2"
    assert body["mode"] == "mock"

    wav = base64.b64decode(body["wav_base64"])
    assert wav[:4] == b"RIFF" and wav[8:12] == b"WAVE"
    sample_rate, channels, bits, data_size = parse_wav_header(wav)
    assert (sample_rate, channels, bits) == (SAMPLE_RATE, 1, 16)
    assert abs(body["duration_ms"] - round(data_size / (sample_rate * channels * 2) * 1000)) <= 1


def test_word_timestamps_cover_whole_duration() -> None:
    body = client.post("/synth", json={"text": "鎏金台开场，灯光亮起。", "target_duration_ms": 3000}).json()
    stamps = body["word_timestamps"]

    assert stamps, "词级时间戳不能为空"
    assert stamps[0]["start_ms"] == 0
    assert stamps[-1]["end_ms"] == body["duration_ms"]
    assert all(item["end_ms"] > item["start_ms"] for item in stamps)
    assert all(left["start_ms"] <= right["start_ms"] for left, right in zip(stamps, stamps[1:]))
    # 标点成块：第一块以“，”收尾，最后一块以“。”收尾
    assert stamps[0]["word"].endswith("，")
    assert stamps[-1]["word"].endswith("。")


def test_target_duration_is_honored() -> None:
    body = client.post("/synth", json={"text": "短句校验", "target_duration_ms": 2000}).json()
    assert body["duration_ms"] == 2000


def test_payload_is_actually_silent() -> None:
    body = client.post("/synth", json={"text": "静音校验", "target_duration_ms": 500}).json()
    wav = base64.b64decode(body["wav_base64"])
    assert len(wav) > 44
    assert set(wav[44:]) == {0}


def test_estimate_scales_with_speed() -> None:
    slow = estimate_duration_ms("同一句台词用于语速对比", 0.9)
    fast = estimate_duration_ms("同一句台词用于语速对比", 1.2)
    assert fast < slow


@pytest.mark.parametrize(
    "payload",
    [
        {"text": "   "},                      # 纯空白
        {"text": ""},                         # 空串
        {"text": "合法台词", "speed": 5.0},     # 语速越界
        {"text": "合法台词", "target_duration_ms": MAX_DURATION_MS + 1},
    ],
)
def test_invalid_requests_are_rejected(payload: dict) -> None:
    assert client.post("/synth", json=payload).status_code == 422
