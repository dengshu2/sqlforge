"""POST /api/diff — SQL semantic diff endpoint."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from sqlforge.engine import diff_sql
from sqlforge.schemas import DiffRequest, DiffResponse, ErrorResponse

router = APIRouter()


@router.post(
    "/diff",
    response_model=DiffResponse,
    responses={422: {"model": ErrorResponse}},
)
async def diff_endpoint(req: DiffRequest) -> DiffResponse:
    try:
        changes, summary = diff_sql(
            req.source_sql,
            req.target_sql,
            req.dialect,
        )
        return DiffResponse(
            changes=changes,
            summary=summary,
        )
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))
