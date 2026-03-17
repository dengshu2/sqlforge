"""SQLForge — SQL formatting and dialect transpilation API."""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from sqlforge.routes import format, transpile, parse, diff, lineage
from sqlforge.schemas import DialectsResponse, SUPPORTED_DIALECTS

STATIC_DIR = os.getenv("STATIC_DIR", "")

app = FastAPI(
    title="SQLForge",
    description="SQL formatting and dialect transpilation powered by sqlglot",
    version="0.1.0",
    docs_url="/api/docs",
    redoc_url=None,
)

cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(format.router, prefix="/api", tags=["format"])
app.include_router(transpile.router, prefix="/api", tags=["transpile"])

app.include_router(parse.router, prefix="/api", tags=["parse"])
app.include_router(diff.router, prefix="/api", tags=["diff"])
app.include_router(lineage.router, prefix="/api", tags=["lineage"])


@app.get("/api/dialects", response_model=DialectsResponse, tags=["meta"])
async def get_dialects() -> DialectsResponse:
    return DialectsResponse(dialects=SUPPORTED_DIALECTS)


@app.get("/health")
async def health():
    return {"status": "ok"}


if STATIC_DIR:
    static_path = Path(STATIC_DIR)
    if static_path.is_dir():
        app.mount("/assets", StaticFiles(directory=static_path / "assets"), name="assets")

        @app.get("/{full_path:path}")
        async def serve_spa(full_path: str):
            file_path = static_path / full_path
            if file_path.is_file():
                return FileResponse(file_path)
            return FileResponse(static_path / "index.html")


def run():
    import uvicorn

    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)


if __name__ == "__main__":
    run()
