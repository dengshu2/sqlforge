"""Pydantic models for request/response validation."""

from __future__ import annotations

from pydantic import BaseModel, Field


SUPPORTED_DIALECTS = [
    "bigquery",
    "clickhouse",
    "databricks",
    "doris",
    "drill",
    "duckdb",
    "hive",
    "materialize",
    "mysql",
    "oracle",
    "postgres",
    "presto",
    "redshift",
    "snowflake",
    "spark",
    "sqlite",
    "starrocks",
    "tableau",
    "teradata",
    "trino",
    "tsql",
]


class FormatRequest(BaseModel):
    sql: str = Field(..., min_length=1, description="SQL to format")
    dialect: str = Field(default="", description="Source dialect (empty = auto-detect)")
    indent: int = Field(default=2, ge=1, le=8, description="Indentation width")


class FormatResponse(BaseModel):
    formatted: str
    dialect: str


class TranspileRequest(BaseModel):
    sql: str = Field(..., min_length=1, description="SQL to transpile")
    source_dialect: str = Field(default="", description="Source dialect")
    target_dialect: str = Field(..., min_length=1, description="Target dialect")
    pretty: bool = Field(default=True, description="Pretty-print output")
    identify: bool = Field(default=False, description="Delimit identifiers")


class TranspileResponse(BaseModel):
    result: str
    source_dialect: str
    target_dialect: str
    warnings: list[str] = []


class OptimizeRequest(BaseModel):
    sql: str = Field(..., min_length=1, description="SQL to optimize")
    dialect: str = Field(default="", description="SQL dialect")
    schema_def: dict[str, dict[str, str]] | None = Field(
        default=None,
        alias="schema",
        description="Table schema for optimization context",
    )


class OptimizeResponse(BaseModel):
    optimized: str
    rules_applied: list[str] = []


class ParseRequest(BaseModel):
    sql: str = Field(..., min_length=1, description="SQL to parse")
    dialect: str = Field(default="", description="SQL dialect")


class ParseResponse(BaseModel):
    ast: dict
    tables: list[str]
    columns: list[str]


class DiffRequest(BaseModel):
    source_sql: str = Field(..., min_length=1, description="Source SQL")
    target_sql: str = Field(..., min_length=1, description="Target SQL")
    dialect: str = Field(default="", description="SQL dialect")


class DiffResponse(BaseModel):
    changes: list[dict]
    summary: dict


class LineageRequest(BaseModel):
    sql: str = Field(..., min_length=1, description="SQL to analyze")
    column: str = Field(..., min_length=1, description="Column to trace")
    dialect: str = Field(default="", description="SQL dialect")
    schema_def: dict[str, dict[str, str]] | None = Field(
        default=None,
        alias="schema",
        description="Table schema for lineage analysis",
    )


class LineageResponse(BaseModel):
    column: str
    lineage: list[dict]


class ErrorResponse(BaseModel):
    error: str
    detail: str | None = None
    line: int | None = None
    col: int | None = None


class DialectsResponse(BaseModel):
    dialects: list[str]
