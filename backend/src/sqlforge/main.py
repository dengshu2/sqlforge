"""SQLForge: SQL formatting, dialect transpilation and analysis.

One process serves the API under /api and the built page from STATIC_DIR.
"""

from __future__ import annotations

import logging
import math
import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from sqlglot.errors import SqlglotError

from sqlforge.api import router
from sqlforge.engine import SQLError
from sqlforge.limits import RateLimiter

log = logging.getLogger("sqlforge")


def _csp(analytics: str) -> str:
    return "; ".join([
        "default-src 'self'",
        f"script-src 'self' {analytics}".strip(),
        "style-src 'self' 'unsafe-inline'",  # CodeMirror injects its own styles
        "img-src 'self' data:",
        "font-src 'self'",
        f"connect-src 'self' {analytics}".strip(),
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
        "object-src 'none'",
    ])


# Swagger UI comes from jsDelivr and starts with an inline script.
DOCS_CSP = (
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: https://fastapi.tiangolo.com; "
    "frame-ancestors 'none'"
)


def create_app(
    static_dir: str = "",
    client_ip_header: str = "",
    analytics_origins: str = "",
    rate: float = 1.0,
    burst: int = 30,
) -> FastAPI:
    app = FastAPI(
        title="SQLForge",
        description="SQL formatting, dialect transpilation and analysis, powered by sqlglot.",
        version="0.2.0",
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
    )
    app.include_router(router)
    limiter = RateLimiter(rate, burst)
    page_csp = _csp(analytics_origins)
    ip_header = client_ip_header.lower()

    @app.middleware("http")
    async def guard(request: Request, call_next):
        path = request.url.path
        if request.method == "POST" and path.startswith("/api/"):
            client = request.client.host if request.client else ""
            key = (request.headers.get(ip_header) if ip_header else None) or client
            wait = limiter.take(key)
            if wait:
                log.warning("event=rate_limited ip=%s path=%s", key, path)
                return JSONResponse(
                    {"detail": "Too many requests, try again shortly", "errors": []},
                    status_code=429,
                    headers={"Retry-After": str(math.ceil(wait))},
                )
        response: Response = await call_next(request)
        h = response.headers
        h["X-Content-Type-Options"] = "nosniff"
        h["Referrer-Policy"] = "strict-origin-when-cross-origin"
        h["X-Frame-Options"] = "DENY"
        h["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        h["Content-Security-Policy"] = DOCS_CSP if path == "/api/docs" else page_csp
        if path.startswith("/assets/") and response.status_code == 200:
            h["Cache-Control"] = "public, max-age=31536000, immutable"  # names carry a content hash
        elif path.startswith("/api/") or path == "/health":
            h["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(SQLError)
    async def sql_error(request: Request, exc: SQLError):
        return JSONResponse({"detail": str(exc), "errors": exc.errors}, status_code=422)

    @app.exception_handler(SqlglotError)
    async def sqlglot_error(request: Request, exc: SqlglotError):
        return JSONResponse({"detail": str(exc), "errors": []}, status_code=422)

    @app.exception_handler(RecursionError)
    async def too_deep(request: Request, exc: RecursionError):
        return JSONResponse({"detail": "SQL is nested too deeply", "errors": []}, status_code=422)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request: Request, exc: RequestValidationError):
        parts = []
        for err in exc.errors():
            where = ".".join(str(p) for p in err.get("loc", ()) if p != "body")
            parts.append(f"{where}: {err.get('msg', 'invalid')}" if where else err.get("msg", "invalid"))
        return JSONResponse({"detail": "; ".join(parts) or "Invalid request", "errors": []}, status_code=422)

    @app.get("/health", include_in_schema=False)
    def health():
        return {"status": "ok"}

    root = Path(static_dir).resolve() if static_dir else None
    if root and root.is_dir():
        if (root / "assets").is_dir():
            app.mount("/assets", StaticFiles(directory=root / "assets"), name="assets")
        # The page has no routes of its own: "/" plus the few files next to
        # index.html, known at startup. Anything else is a plain 404.
        files = {p.name: p for p in root.iterdir() if p.is_file() and p.name != "index.html"}

        @app.api_route("/", methods=["GET", "HEAD"], include_in_schema=False)
        def index():
            return FileResponse(root / "index.html", headers={"Cache-Control": "no-cache"})

        @app.api_route("/{name}", methods=["GET", "HEAD"], include_in_schema=False)
        def top_level_file(name: str):
            if name not in files:
                return JSONResponse({"detail": "Not Found"}, status_code=404)
            return FileResponse(files[name], headers={"Cache-Control": "public, max-age=86400"})

    return app


app = create_app(
    static_dir=os.getenv("STATIC_DIR", ""),
    client_ip_header=os.getenv("CLIENT_IP_HEADER", ""),
    analytics_origins=os.getenv("ANALYTICS_ORIGINS", ""),
    rate=float(os.getenv("RATE_PER_SECOND", "1")),
    burst=int(os.getenv("RATE_BURST", "30")),
)


def run():
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8000")))


if __name__ == "__main__":
    run()
