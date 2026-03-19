# syntax=docker/dockerfile:1

# ── Stage 1: Build frontend ──────────────────────────────────────────────────
FROM node:22-alpine AS frontend-builder
WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --prefer-offline

COPY frontend/ .

ARG VITE_UMAMI_WEBSITE_ID
RUN npm run build

# ── Stage 2: Build Python backend ────────────────────────────────────────────
FROM ghcr.io/astral-sh/uv:python3.13-alpine AS backend-builder
WORKDIR /app

ENV UV_COMPILE_BYTECODE=1
ENV UV_LINK_MODE=copy

COPY backend/pyproject.toml backend/uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project --no-dev

COPY backend/src ./src
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

# ── Stage 3: Runtime ─────────────────────────────────────────────────────────
FROM python:3.13-alpine
WORKDIR /app

RUN adduser -D appuser

COPY --from=backend-builder /app/.venv /app/.venv
COPY --from=backend-builder /app/src /app/src
COPY --from=frontend-builder /app/dist /app/static

ENV PATH="/app/.venv/bin:$PATH"
ENV STATIC_DIR=/app/static
ENV PORT=8080
ENV TZ=Asia/Shanghai

EXPOSE 8080

USER appuser

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8080/health || exit 1

CMD ["uvicorn", "sqlforge.main:app", "--host", "0.0.0.0", "--port", "8080"]
