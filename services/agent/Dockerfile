# 鎏金台 · GPU 侧 ComfyUI Agent（CPU 版镜像；MOCK_MODE=1 时不需要 GPU）
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    MOCK_MODE=1 \
    CENTER_URL=http://center:8787 \
    AGENT_TOKEN=aurum-dev-agent-token \
    NODE_KEY=gpu-a \
    NODE_BASE_URL=http://127.0.0.1:9100 \
    ENGINE_TAGS=h3,lipsync \
    COMFYUI_URL=http://127.0.0.1:8188 \
    VRAM_TOTAL_GB=24 \
    H3_MAX_DURATION_SEC=8 \
    AGENT_HTTP_PORT=9100

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

EXPOSE 9100
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:9100/health', timeout=3)"

CMD ["python", "agent.py"]
