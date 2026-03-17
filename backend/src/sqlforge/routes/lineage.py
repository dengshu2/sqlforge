"""POST /api/lineage — Column lineage endpoint."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from sqlforge.engine import lineage_sql
from sqlforge.schemas import LineageRequest, LineageResponse, ErrorResponse

router = APIRouter()


@router.post(
    "/lineage",
    response_model=LineageResponse,
    responses={422: {"model": ErrorResponse}},
)
async def lineage_endpoint(req: LineageRequest) -> LineageResponse:
    try:
        lineage = lineage_sql(
            req.sql,
            req.column,
            req.dialect,
            req.schema_def,
        )
        return LineageResponse(
            column=req.column,
            lineage=lineage,
        )
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))
