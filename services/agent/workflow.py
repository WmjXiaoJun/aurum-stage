"""workflow_json 参数注入：与 services/api/src/adapters/video.ts 的 injectWorkflow 完全同构。"""
from __future__ import annotations

import copy
from typing import Any


def inject_params(
    workflow: dict[str, Any],
    param_map: dict[str, Any],
    params: dict[str, Any],
) -> dict[str, Any]:
    """把 params 注入 workflow 指定节点的字段。

    param_map 形如 {"prompt": {"node": "6", "field": "inputs.text"}}：
      - node 不存在 → 跳过（与中台行为一致，避免把半成品 workflow 提交给 ComfyUI）；
      - field 支持点号路径，中途缺失的层级自动补空字典；
      - params 里没有的键不注入，保留模板默认值。
    """
    result = copy.deepcopy(workflow or {})
    for param_key, target in (param_map or {}).items():
        if param_key not in (params or {}) or not isinstance(target, dict):
            continue
        node_id = str(target.get("node") or "")
        field_path = str(target.get("field") or "inputs.text")
        node = result.get(node_id)
        if not isinstance(node, dict):
            continue
        _assign_path(node, field_path.split("."), params[param_key])
    return result


def _assign_path(node: dict[str, Any], parts: list[str], value: Any) -> None:
    """按 parts 逐层下钻并赋值，缺失层补空 dict。"""
    cursor = node
    for key in parts[:-1]:
        child = cursor.get(key)
        if not isinstance(child, dict):
            child = {}
            cursor[key] = child
        cursor = child
    cursor[parts[-1]] = copy.deepcopy(value)
