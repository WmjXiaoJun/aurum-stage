"""WAV 构造与词级时间戳估算：纯标准库实现，保证没装模型也能产出中台可直接消费的音频。

- 采样率 22050Hz、单声道、PCM16（与中台 media/wav.ts 的写法同构，但按本文档约定用 22050）；
- 静音帧全 0，写标准 44 字节 RIFF 头；
- 时间戳按标点与字重分配，最后一块强制收口到 duration_ms。
"""
from __future__ import annotations

import struct

SAMPLE_RATE = 22050
CHANNELS = 1
BITS_PER_SAMPLE = 16
BYTES_PER_FRAME = CHANNELS * (BITS_PER_SAMPLE // 8)

# 标点后的停顿（毫秒），与中台 adapters/tts.ts 的 PAUSE_AFTER_PUNCT 保持一致的量级
PAUSE_AFTER_PUNCT: dict[str, int] = {
    "，": 200, ",": 200, "。": 500, ".": 500, "？": 400, "?": 400,
    "！": 600, "!": 600, "；": 300, ";": 300, "、": 150, "：": 200, ":": 200,
}
MAX_CHUNK_CHARS = 12


def encode_silence_wav(duration_ms: int, sample_rate: int = SAMPLE_RATE, channels: int = CHANNELS) -> bytes:
    """生成等长静音 WAV：标准 RIFF/WAVE 头 + 全 0 PCM16 帧。"""
    frames = max(1, int(round(max(0, int(duration_ms)) * sample_rate / 1000)))
    data = b"\x00" * (frames * channels * (BITS_PER_SAMPLE // 8))
    byte_rate = sample_rate * channels * (BITS_PER_SAMPLE // 8)
    block_align = channels * (BITS_PER_SAMPLE // 8)
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF", 36 + len(data), b"WAVE",
        b"fmt ", 16, 1, channels, sample_rate,
        byte_rate, block_align, BITS_PER_SAMPLE,
        b"data", len(data),
    )
    return header + data


def parse_wav_header(wav: bytes) -> tuple[int, int, int, int]:
    """解析 RIFF 头，返回 (sample_rate, channels, bits_per_sample, data_size)；格式不对抛 ValueError。"""
    if len(wav) < 44 or wav[:4] != b"RIFF" or wav[8:12] != b"WAVE":
        raise ValueError("不是合法的 RIFF/WAVE 字节流")
    channels = struct.unpack("<H", wav[22:24])[0]
    sample_rate = struct.unpack("<I", wav[24:28])[0]
    bits = struct.unpack("<H", wav[34:36])[0]
    data_size = struct.unpack("<I", wav[40:44])[0]
    return sample_rate, channels, bits, data_size


def wav_duration_ms(wav: bytes) -> int:
    """按真实头信息算时长，保证响应里的 duration_ms 与实际字节一一对应。"""
    sample_rate, channels, bits, data_size = parse_wav_header(wav)
    frame_bytes = max(1, channels * (bits // 8))
    return int(round(data_size / frame_bytes / sample_rate * 1000))


def estimate_duration_ms(text: str, speed: float = 1.0) -> int:
    """按中文语速 ≈4.6 字/秒估算（与中台 adapters/tts.ts 的 estimateDurationMs 同口径）。"""
    chars = len("".join(str(text or "").split()))
    rate = max(0.5, min(2.0, float(speed or 1.0)))
    return max(900, int(round(chars / 4.6 * 1000 / rate)))


def estimate_word_timestamps(text: str, duration_ms: int) -> list[dict[str, int | str]]:
    """按标点与字数切块并分配时长；标点附在词尾，保证 SRT 直接可用。"""
    chars = list(str(text or ""))
    if not chars or duration_ms <= 0:
        return []

    weights = [_char_weight(ch) for ch in chars]
    total = sum(weights) or 1.0
    span = float(duration_ms)
    out: list[dict[str, int | str]] = []
    cursor = 0.0
    buffer: list[str] = []
    chunk_start = 0.0

    for index, ch in enumerate(chars):
        if not buffer:
            chunk_start = cursor
        cursor += weights[index] / total * span
        buffer.append(ch)
        if ch in PAUSE_AFTER_PUNCT or len(buffer) >= MAX_CHUNK_CHARS or index == len(chars) - 1:
            out.append(
                {
                    "word": "".join(buffer),
                    "start_ms": min(int(duration_ms), int(round(chunk_start))),
                    "end_ms": min(int(duration_ms), int(round(cursor))),
                }
            )
            buffer = []

    for item in out:  # 保证每块 end > start，且首块从 0 开始
        item["start_ms"] = int(item["start_ms"])
        item["end_ms"] = max(int(item["start_ms"]) + 1, int(item["end_ms"]))
    out[0]["start_ms"] = 0
    out[-1]["end_ms"] = max(int(duration_ms), int(out[-1]["start_ms"]) + 1)
    return out


def _char_weight(ch: str) -> float:
    """字重：空白最轻，标点最重（自带停顿），汉字 1.0，拉丁/数字 0.45。"""
    if ch.isspace():
        return 0.2
    pause = PAUSE_AFTER_PUNCT.get(ch)
    if pause is not None:
        return 1.0 + pause / 300.0
    if "\u4e00" <= ch <= "\u9fff":
        return 1.0
    return 0.45
