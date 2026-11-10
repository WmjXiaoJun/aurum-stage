"""鎏金台 AURUM STAGE · 本地 TTS 推理服务（FastAPI 封装 IndexTTS-2）。

- POST /synth  {text, voice_id, emotion_instruction, speed, target_duration_ms, ref_audio_paths}
              → {wav_base64, duration_ms, word_timestamps:[{word,start_ms,end_ms}], engine, mode}
- GET  /health → {ok:true, engine:"indextts2", loaded:false, mode:"mock"}

未安装 IndexTTS-2 时：纯 Python 生成等长静音 WAV（22050Hz 单声道 PCM16）+
按标点估算词级时间戳，中台 TTS 链路可直接消费（时长、时间戳、WAV 头都合法）。
安装模型后：只改 IndexTTS2Engine.try_load 与 _synth_real 两处 TODO。
"""
from __future__ import annotations

import base64
import json
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel, Field, field_validator

from wav_util import (
    CHANNELS,
    SAMPLE_RATE,
    encode_silence_wav,
    estimate_duration_ms,
    estimate_word_timestamps,
    wav_duration_ms,
)

ENGINE_NAME = "indextts2"
MAX_DURATION_MS = 120_000
MIN_DURATION_MS = 200
DEFAULT_PORT = 9001


def _log(event: str, **fields: Any) -> None:
    """一行一条 JSON 日志，便于和 GPU Agent 的日志一起采集。"""
    payload: dict[str, Any] = {
        "ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
        "service": "tts-worker",
        "event": event,
    }
    payload.update(fields)
    print(json.dumps(payload, ensure_ascii=False, default=str), file=sys.stdout, flush=True)


# ============================================================ 数据契约

class SynthRequest(BaseModel):
    """中台 TTS 任务过来的合成请求。"""

    text: str = Field(..., description="台词原文（中文/英文/混排均可）")
    voice_id: str = Field(default="v_narrator", description="音色 ID，映射到 IndexTTS-2 的参考音色")
    emotion_instruction: str | None = Field(default=None, description="自然语言情绪指令，如“压低声音、放慢语速”")
    speed: float = Field(default=1.0, ge=0.5, le=2.0, description="语速倍率")
    target_duration_ms: int | None = Field(
        default=None, ge=100, le=MAX_DURATION_MS, description="目标时长（中台按时长驱动，优先于自然语速估算）"
    )
    ref_audio_paths: list[str] = Field(default_factory=list, description="参考音频路径，供音色克隆/情绪参考")

    @field_validator("text")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        """台词不允许只有空白，避免下游拿到 0 长度音频。"""
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("text 不能为空")
        return cleaned


class WordTimestamp(BaseModel):
    """词级时间戳：start_ms/end_ms 单位毫秒，供字幕对齐。"""

    word: str
    start_ms: int
    end_ms: int


class SynthResponse(BaseModel):
    wav_base64: str
    duration_ms: int
    word_timestamps: list[WordTimestamp]
    engine: str
    mode: str


class HealthResponse(BaseModel):
    ok: bool
    engine: str
    loaded: bool
    mode: str


@dataclass(frozen=True, slots=True)
class SynthOutcome:
    """引擎层返回值（未做 base64）。"""

    wav: bytes
    duration_ms: int
    word_timestamps: list[dict[str, int | str]]
    mode: str


# ============================================================ 引擎封装

class IndexTTS2Engine:
    """IndexTTS-2 适配层：懒加载；缺模型时降级为静音占位合成，从不 500。"""

    def __init__(self) -> None:
        self.name = ENGINE_NAME
        self.loaded = False
        self.mode = "mock"
        self.model: Any = None
        self.load_error: str | None = None

    def try_load(self) -> bool:
        """尝试加载本地权重；任何异常都只降级，不影响 /health 可用。"""
        if os.environ.get("TTS_FORCE_MOCK", "0").strip().lower() in {"1", "true", "yes", "on"}:
            _log("engine_force_mock")
            return False
        try:
            import indextts  # type: ignore[import-not-found]  # noqa: F401
        except Exception as exc:
            self.load_error = f"{type(exc).__name__}: {exc}"
            _log("engine_missing", error=self.load_error, fallback="silence")
            return False

        # TODO(模型) 1/2 —— 真实加载：把下面两行换成你本地部署的调用。
        #   model_dir = os.environ.get("TTS_MODEL_DIR", "/models/IndexTTS-2")
        #   self.model = indextts.IndexTTS2(model_dir=model_dir,
        #                                   cfg_path=os.path.join(model_dir, "config.yaml"),
        #                                   use_fp16=True, device=os.environ.get("TTS_DEVICE", "cuda"))
        # 加载成功后：self.loaded = True; self.mode = "model"
        _log("engine_detected_not_wired", note="indextts 包存在但加载未接线，继续 mock")
        self.loaded = False
        self.mode = "mock"
        return False

    def synth(self, request: SynthRequest) -> SynthOutcome:
        """合成入口：优先真实推理，失败/未加载一律回退静音占位。"""
        if self.loaded and self.model is not None:
            try:
                return self._synth_real(request)
            except Exception as exc:  # 真实推理炸了也要让中台拿到可消费音频
                _log("engine_synth_failed", error=f"{type(exc).__name__}: {exc}", fallback="silence")
        return self._synth_mock(request)

    def _synth_real(self, request: SynthRequest) -> SynthOutcome:
        """TODO(模型) 2/2 —— 真实推理：返回 wav 字节 + 时长 + 词级时间戳。

        参考实现形态（照此替换即可）：
            wav_path = self.model.infer(
                text=request.text,
                voice_id=request.voice_id,
                emotion_instruction=request.emotion_instruction or "",
                speed=request.speed,
                ref_audio_paths=request.ref_audio_paths,
            )
            wav = Path(wav_path).read_bytes()
            duration_ms = wav_duration_ms(wav)
            stamps = self._word_stamps_from_model(...)  # 或用 estimate_word_timestamps 兜底
            return SynthOutcome(wav=wav, duration_ms=duration_ms, word_timestamps=stamps, mode="model")
        """
        raise NotImplementedError("IndexTTS-2 推理尚未接线：见 IndexTTS2Engine._synth_real 的 TODO")

    def _synth_mock(self, request: SynthRequest) -> SynthOutcome:
        """降级路径：等长静音 WAV + 按标点估算的时间戳（duration 与字节严格一致）。"""
        target = request.target_duration_ms or estimate_duration_ms(request.text, request.speed)
        wanted = max(MIN_DURATION_MS, min(MAX_DURATION_MS, int(target)))
        wav = encode_silence_wav(wanted)
        duration_ms = wav_duration_ms(wav)
        stamps = estimate_word_timestamps(request.text, duration_ms)
        return SynthOutcome(wav=wav, duration_ms=duration_ms, word_timestamps=stamps, mode="mock")


# ============================================================ HTTP 适配

def create_app(engine: IndexTTS2Engine | None = None) -> FastAPI:
    """构建 FastAPI 应用；engine 可注入（测试里可换成假模型）。"""
    tts_engine = engine or IndexTTS2Engine()
    if engine is None:
        tts_engine.try_load()
    app = FastAPI(
        title="Aurum Stage · TTS Worker",
        version="1.0.0",
        description="鎏金台本地 TTS 推理服务（IndexTTS-2 封装，无模型时静音占位降级）",
    )

    @app.get("/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        """健康检查：中台 adapters/tts.ts 用它对 9001 端口做探活。"""
        return HealthResponse(ok=True, engine=ENGINE_NAME, loaded=tts_engine.loaded, mode=tts_engine.mode)

    @app.post("/synth", response_model=SynthResponse)
    def synth(request: SynthRequest) -> SynthResponse:
        """合成语音：返回 base64 WAV + 时长 + 词级时间戳。"""
        outcome = tts_engine.synth(request)
        _log(
            "synth",
            text_len=len(request.text),
            voice_id=request.voice_id,
            speed=request.speed,
            target_duration_ms=request.target_duration_ms,
            duration_ms=outcome.duration_ms,
            words=len(outcome.word_timestamps),
            mode=outcome.mode,
            sample_rate=SAMPLE_RATE,
            channels=CHANNELS,
        )
        return SynthResponse(
            wav_base64=base64.b64encode(outcome.wav).decode("ascii"),
            duration_ms=outcome.duration_ms,
            word_timestamps=[WordTimestamp(**item) for item in outcome.word_timestamps],  # type: ignore[arg-type]
            engine=ENGINE_NAME,
            mode=outcome.mode,
        )

    return app


_ENGINE = IndexTTS2Engine()
_ENGINE.try_load()
app = create_app(_ENGINE)


def main() -> None:
    """进程入口：uvicorn 托管（默认 0.0.0.0:9001，与中台 TTS_WORKER_URL 默认值对齐）。"""
    import uvicorn

    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", str(DEFAULT_PORT)))
    _log("tts_worker_boot", host=host, port=port, engine=ENGINE_NAME, loaded=_ENGINE.loaded, mode=_ENGINE.mode)
    uvicorn.run(app, host=host, port=port, log_level=os.environ.get("LOG_LEVEL", "warning").lower())


if __name__ == "__main__":
    main()
