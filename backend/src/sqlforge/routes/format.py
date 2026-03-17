"""POST /api/format — SQL formatting endpoint."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from sqlforge.engine import format_sql
from sqlforge.schemas import FormatRequest, FormatResponse, ErrorResponse

router = APIRouter()


@router.post(
    "/format",
    response_model=FormatResponse,
    responses={422: {"model": ErrorResponse}},
)
async def format_endpoint(req: FormatRequest) -> FormatResponse:
    try:
        formatted = format_sql(req.sql, req.dialect, req.indent)
        return FormatResponse(
            formatted=formatted,
            dialect=req.dialect or "generic",
        )
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))
