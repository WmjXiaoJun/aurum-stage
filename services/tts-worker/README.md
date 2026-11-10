# services/tts-worker · 玄枢本地 TTS 推理服务

FastAPI 封装 IndexTTS-2，给中台 `TTS_WORKER_URL`（默认 `http://127.0.0.1:9001`）提供合成能力。

- **没装 IndexTTS-2 也能跑**：纯 Python 生成等长静音 WAV（标准 RIFF 头、22050Hz、单声道、PCM16），
  并按标点估算词级时间戳，时长与字节严格一致，中台字幕/时长驱动链路可直接消费；
- 装好权重后只需替换 `IndexTTS2Engine.try_load` 与 `_synth_real` 两处 TODO，接口与响应形状不变；
- 真实推理抛异常时自动降级静音占位，`/synth` 不会 500。

## 启动（3 行）

```bash
pip install -r requirements.txt
export HOST=0.0.0.0 PORT=9001            # Windows: $env:HOST="0.0.0.0"; $env:PORT="9001"
python tts_worker.py
```

## 协议表

| 方法 | 路径 | 请求体 | 响应 |
| --- | --- | --- | --- |
| POST | `/synth` | `{text, voice_id, emotion_instruction, speed, target_duration_ms, ref_audio_paths}` | `{wav_base64, duration_ms, word_timestamps:[{word,start_ms,end_ms}], engine, mode}` |
| GET | `/health` | — | `{ok:true, engine:"indextts2", loaded:false, mode:"mock"}` |

请求字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `text` | string | 是 | 台词原文，纯空白会被拒（422） |
| `voice_id` | string | 否 | 音色 ID，默认 `v_narrator` |
| `emotion_instruction` | string \| null | 否 | 自然语言情绪指令，如“压低声音、放慢语速” |
| `speed` | float 0.5~2.0 | 否 | 语速倍率，默认 1.0 |
| `target_duration_ms` | int 100~120000 | 否 | 目标时长，优先于自然语速估算（audio-first 时长驱动） |
| `ref_audio_paths` | string[] | 否 | 参考音频路径，供音色克隆/情绪参考 |

响应示例（降级模式）：

```json
{
  "wav_base64": "UklGRiQAAABXQVZFZm10IBAAAAABAAEAWlIAAABaUgAAAgAQAGRhdGEAAAAA...",
  "duration_ms": 2000,
  "word_timestamps": [
    {"word": "玄枢开场，", "start_ms": 0, "end_ms": 1180},
    {"word": "灯光亮起。", "start_ms": 1180, "end_ms": 2000}
  ],
  "engine": "indextts2",
  "mode": "mock"
}
```

`mode` 是给调用方判断降级用的附加字段（`mock` = 静音占位，`model` = 真实推理）；`engine` 恒为 `indextts2`。

## 降级行为

- 时长：`target_duration_ms` 优先；缺省按中文 ≈4.6 字/秒估算（`max(900ms, 字数/4.6/语速)`），与中台 `adapters/tts.ts` 同口径；
- 音频：等长静音，采样率 22050Hz、单声道、16bit；`duration_ms` 由 WAV 头反算，保证与 base64 字节一致；
- 时间戳：按标点（，。？！；、：等）与字重切块，块长 ≤12 字，首块从 0 开始、末块收口到 `duration_ms`。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `HOST` / `PORT` | `0.0.0.0` / `9001` | 监听地址，与中台 `TTS_WORKER_URL` 对齐 |
| `TTS_FORCE_MOCK` | `0` | `1` 时即使装了包也用静音占位（CI / 压测用） |
| `TTS_MODEL_DIR` | `/models/IndexTTS-2` | 真实权重的目录（TODO 里用到） |
| `TTS_DEVICE` | `cuda` | 真实推理设备 |

## 接真实模型（2 处 TODO）

1. `IndexTTS2Engine.try_load`：把 `import indextts` 之后的注释两行换成真实加载，成功时置 `self.loaded = True; self.mode = "model"`；
2. `IndexTTS2Engine._synth_real`：调用 `self.model.infer(...)` 拿到 WAV 路径 → 读字节 → `wav_duration_ms` 算时长 → 返回
   `SynthOutcome(wav=..., duration_ms=..., word_timestamps=..., mode="model")`（时间戳拿不到时可用 `estimate_word_timestamps` 兜底）。

## 测试

```bash
pip install -r requirements.txt
python -m pytest -q
python -m compileall -q .
```

`tests/test_synth_smoke.py` 覆盖：`/health` 形状、`/synth` 响应键与 WAV 头（22050/单声道/16bit）、
`duration_ms` 与字节一致、时间戳覆盖整段且单调、`target_duration_ms` 生效、静音帧全 0、语速影响估算、非法入参 422。
