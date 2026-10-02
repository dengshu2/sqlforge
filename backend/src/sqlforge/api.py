"""The /api routes. Handlers are plain functions so FastAPI runs them in its
thread pool: sqlglot is CPU-bound and would otherwise stall every request."""

from __future__ import annotations

from fastapi import APIRouter

from sqlforge import engine
from sqlforge.schemas import (
    SUPPORTED_DIALECTS,
    AnalyzeRequest,
    AnalyzeResponse,
    DialectsResponse,
    DiffRequest,
    DiffResponse,
    ErrorResponse,
    FormatRequest,
    FormatResponse,
    LineageRequest,
    LineageResponse,
    ParseRequest,
    ParseResponse,
    TranspileRequest,
    TranspileResponse,
)

router = APIRouter(prefix="/api", responses={422: {"model": ErrorResponse}, 429: {"model": ErrorResponse}})


@router.post("/format", response_model=FormatResponse, tags=["sql"])
def format_sql(req: FormatRequest) -> FormatResponse:
    formatted = engine.format_sql(req.sql, req.dialect, req.indent)
    return FormatResponse(formatted=formatted, dialect=req.dialect or "generic")


@router.post("/transpile", response_model=TranspileResponse, tags=["sql"])
def transpile_sql(req: TranspileRequest) -> TranspileResponse:
    out = engine.transpile_sql(req.sql, req.source_dialect, req.target_dialect, req.pretty, req.identify)
    return TranspileResponse(source_dialect=req.source_dialect or "generic", target_dialect=req.target_dialect, **out)


@router.post("/analyze", response_model=AnalyzeResponse, tags=["analysis"])
def analyze_sql(req: AnalyzeRequest) -> AnalyzeResponse:
    """Tree, tables, columns and lineage of sql; with target_sql, also the
    structural diff from sql to it. Parts that fail are listed in errors."""
    return AnalyzeResponse(**engine.analyze_sql(req.sql, req.dialect, req.target_sql, req.target_dialect))


@router.post("/parse", response_model=ParseResponse, tags=["analysis"])
def parse_sql(req: ParseRequest) -> ParseResponse:
    ast, tables, columns = engine.parse_sql(req.sql, req.dialect)
    return ParseResponse(ast=ast, tables=tables, columns=columns)


@router.post("/diff", response_model=DiffResponse, tags=["analysis"])
def diff_sql(req: DiffRequest) -> DiffResponse:
    changes, summary = engine.diff_sql(req.source_sql, req.target_sql, req.dialect, req.target_dialect)
    return DiffResponse(changes=changes, summary=summary)


@router.post("/lineage", response_model=LineageResponse, tags=["analysis"])
def lineage_sql(req: LineageRequest) -> LineageResponse:
    return LineageResponse(mappings=engine.lineage_sql(req.sql, req.dialect, req.schema_def))


@router.get("/dialects", response_model=DialectsResponse, tags=["meta"])
def dialects() -> DialectsResponse:
    return DialectsResponse(dialects=SUPPORTED_DIALECTS)
