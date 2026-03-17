"""POST /api/parse — SQL parsing / AST endpoint."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from sqlforge.engine import parse_sql
from sqlforge.schemas import ParseRequest, ParseResponse, ErrorResponse

router = APIRouter()


@router.post(
    "/parse",
    response_model=ParseResponse,
    responses={422: {"model": ErrorResponse}},
)
async def parse_endpoint(req: ParseRequest) -> ParseResponse:
    try:
        ast, tables, columns = parse_sql(req.sql, req.dialect)
        return ParseResponse(
            ast=ast,
            tables=tables,
            columns=columns,
        )
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))
