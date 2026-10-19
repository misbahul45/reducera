# syntax=docker/dockerfile:1.6
FROM python:3.11-slim AS base
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    UV_LINK_MODE=copy

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        curl \
        ca-certificates \
    && pip install --no-cache-dir --upgrade pip uv \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

FROM base AS deps
WORKDIR /app

COPY pyproject.toml uv.lock ./

ENV UV_HTTP_TIMEOUT=600

RUN uv pip install --system --no-cache \
    "torch==2.9.0+cpu" \
    --index-url https://download.pytorch.org/whl/cpu

RUN uv export --locked --no-dev --no-emit-project --no-hashes \
    | grep -vE '^nvidia-' > /tmp/runtime-requirements.txt \
    && uv pip install --system --no-cache --no-deps -r /tmp/runtime-requirements.txt

RUN uv export --locked --only-group dev --no-emit-project --no-hashes > /tmp/dev-requirements.txt \
    && uv pip install --system --no-cache --no-deps -r /tmp/dev-requirements.txt

FROM base AS runner
WORKDIR /app

ENV PYTHONPATH=/app \
    PORT=3003

RUN groupadd -r reducera && useradd -r -g reducera -m -d /home/reducera reducera \
    && chown -R reducera:reducera /home/reducera

COPY --from=deps /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=deps /usr/local/bin /usr/local/bin

COPY --chown=reducera:reducera . .

USER reducera

EXPOSE 3003

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -fsS http://localhost:3003/ || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "3003", "--workers", "1", "--log-level", "info"]