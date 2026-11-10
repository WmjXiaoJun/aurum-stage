"""错误分类：中台 /fail 只接受 OOM | NODE_ERROR | TIMEOUT | MODEL_MISSING。"""
from __future__ import annotations

from typing import Final

ALLOWED_ERROR_CODES: Final[frozenset[str]] = frozenset({"OOM", "NODE_ERROR", "TIMEOUT", "MODEL_MISSING"})

# ComfyUI / torch / 驱动侧的显存告警特征
OOM_PATTERNS: Final[tuple[str, ...]] = (
    "out of memory",
    "outofmemoryerror",
    "cuda out of memory",
    "cublas_status_alloc_failed",
    "allocation on device",
    "not enough memory",
    "hip out of memory",
    "显存不足",
    "内存不足",
)

# 运行期“模型/权重文件缺失”的特征（节点类缺失属于 NODE_ERROR，不要混进来）
MODEL_MISSING_PATTERNS: Final[tuple[str, ...]] = (
    "model not found",
    "checkpoint not found",
    "no such checkpoint",
    "missing model",
    "cannot find model",
    "weights not found",
    "lora not found",
    "vae not found",
    "模型缺失",
)


class AgentError(Exception):
    """带中台错误码的异常；code 会被收敛到四个合法值之一。"""

    def __init__(self, code: str, message: str) -> None:
        self.code = code if code in ALLOWED_ERROR_CODES else "NODE_ERROR"
        text = " ".join(str(message or "").split())
        self.message = (text or self.code)[:900]
        super().__init__(f"{self.code}: {self.message}")


class TaskTimeout(AgentError):
    """整体任务超时（ComfyUI 长时间无进展 / 等待执行槽超时）。"""

    def __init__(self, message: str = "任务执行超时") -> None:
        super().__init__("TIMEOUT", message)


def classify_text(text: str, default: str = "NODE_ERROR") -> str:
    """按报错文本猜错误码：显存 → OOM，权重缺失 → MODEL_MISSING，其余走 default。"""
    low = (text or "").lower()
    if any(pattern in low for pattern in OOM_PATTERNS):
        return "OOM"
    if any(pattern in low for pattern in MODEL_MISSING_PATTERNS):
        return "MODEL_MISSING"
    return default if default in ALLOWED_ERROR_CODES else "NODE_ERROR"


def classify_exception(exc: BaseException, default: str = "NODE_ERROR") -> AgentError:
    """把任意异常收敛成 AgentError，供 /fail 回传。"""
    if isinstance(exc, AgentError):
        return exc
    if isinstance(exc, TimeoutError):
        return TaskTimeout(str(exc) or "任务执行超时")
    return AgentError(classify_text(f"{type(exc).__name__} {exc}", default), f"{type(exc).__name__}: {exc}")
