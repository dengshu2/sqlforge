"""POST /api/transpile — SQL dialect transpilation endpoint."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from sqlforge.engine import transpile_sql
from sqlforge.schemas import TranspileRequest, TranspileResponse, ErrorResponse

router = APIRouter()


@router.post(
    "/transpile",
    response_model=TranspileResponse,
    responses={422: {"model": ErrorResponse}},
)
async def transpile_endpoint(req: TranspileRequest) -> TranspileResponse:
    try:
        result, warnings = transpile_sql(
            req.sql,
            req.source_dialect,
            req.target_dialect,
            req.pretty,
            req.identify,
        )
        return TranspileResponse(
            result=result,
            source_dialect=req.source_dialect or "generic",
            target_dialect=req.target_dialect,
            warnings=warnings,
        )
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))
