"""POST /api/optimize — SQL optimization endpoint."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from sqlforge.engine import optimize_sql
from sqlforge.schemas import OptimizeRequest, OptimizeResponse, ErrorResponse

router = APIRouter()


@router.post(
    "/optimize",
    response_model=OptimizeResponse,
    responses={422: {"model": ErrorResponse}},
)
async def optimize_endpoint(req: OptimizeRequest) -> OptimizeResponse:
    try:
        optimized, rules = optimize_sql(
            req.sql,
            req.dialect,
            req.schema_def,
        )
        return OptimizeResponse(
            optimized=optimized,
            rules_applied=rules,
        )
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))
