"""Request and response models."""

from __future__ import annotations

from typing import Annotated

from pydantic import AfterValidator, BaseModel, Field

SUPPORTED_DIALECTS = [
    "athena",
    "bigquery",
    "clickhouse",
    "databricks",
    "doris",
    "dremio",
    "drill",
    "druid",
    "duckdb",
    "exasol",
    "fabric",
    "hive",
    "materialize",
    "mysql",
    "oracle",
    "postgres",
    "presto",
    "redshift",
    "risingwave",
    "snowflake",
    "spark",
    "sqlite",
    "starrocks",
    "tableau",
    "teradata",
    "trino",
    "tsql",
]

MAX_SQL_CHARS = 100_000


def _known_dialect(value: str) -> str:
    if value and value not in SUPPORTED_DIALECTS:
        raise ValueError(f"unknown dialect {value!r}; see /api/dialects")
    return value


# "" means sqlglot's generic dialect.
Dialect = Annotated[str, AfterValidator(_known_dialect), Field(max_length=32)]
SQL = Annotated[str, Field(min_length=1, max_length=MAX_SQL_CHARS)]


class FormatRequest(BaseModel):
    sql: SQL
    dialect: Dialect = ""
    indent: int = Field(default=2, ge=1, le=8)


class FormatResponse(BaseModel):
    formatted: str
    dialect: str


class TranspileRequest(BaseModel):
    sql: SQL
    source_dialect: Dialect = ""
    target_dialect: Annotated[Dialect, Field(min_length=1)]
    pretty: bool = True
    identify: bool = Field(default=False, description="Quote every identifier")


class TranspileResponse(BaseModel):
    result: str
    source_dialect: str
    target_dialect: str
    warnings: list[str] = Field(description="Constructs the target dialect cannot express")
    rewritten_functions: list[str] = Field(description="Input function names that the output spells differently")
    untranslated_functions: list[str] = Field(
        description="sqlglot-internal function names left in the output, which the target database will not know"
    )


class ParseRequest(BaseModel):
    sql: SQL
    dialect: Dialect = ""


class ASTNode(BaseModel):
    type: str
    sql: str
    key: str | None = None
    truncated: bool | None = None
    children: list[ASTNode] | None = None


class ParseResponse(BaseModel):
    ast: ASTNode
    tables: list[str]
    columns: list[str]


class DiffRequest(BaseModel):
    source_sql: SQL
    target_sql: SQL
    dialect: Dialect = ""
    target_dialect: Dialect | None = Field(default=None, description="Dialect of target_sql; defaults to dialect")


class DiffChange(BaseModel):
    type: str = Field(description="remove, insert, move or update")
    sql: str
    target: str | None = Field(default=None, description="The new SQL of an update")


class DiffResponse(BaseModel):
    changes: list[DiffChange]
    summary: dict[str, int]


class LineageRequest(BaseModel):
    sql: SQL
    dialect: Dialect = ""
    schema_def: dict[str, dict[str, str]] | None = Field(
        default=None,
        alias="schema",
        description="Table schema, {table: {column: type}}, to resolve SELECT *",
    )


class LineageColumnMapping(BaseModel):
    output: str
    expression: str
    source_table: str | None = None
    source_column: str | None = None
    statement: int | None = Field(default=None, description="1-based statement number when the input has several")


class LineageResponse(BaseModel):
    mappings: list[LineageColumnMapping]


class AnalyzeRequest(BaseModel):
    sql: SQL
    dialect: Dialect = ""
    target_sql: Annotated[str, Field(max_length=MAX_SQL_CHARS)] | None = None
    target_dialect: Dialect | None = None


class AnalyzeDiff(BaseModel):
    changes: list[DiffChange]
    summary: dict[str, int]


class AnalyzeResponse(BaseModel):
    ast: ASTNode | None
    tables: list[str]
    columns: list[str]
    lineage: list[LineageColumnMapping]
    diff: AnalyzeDiff | None
    errors: dict[str, str] = Field(description="Parts that failed (ast, lineage, diff) and why")


class ErrorPosition(BaseModel):
    line: int | None = None
    col: int | None = None
    description: str


class ErrorResponse(BaseModel):
    detail: str
    errors: list[ErrorPosition] = []


class DialectsResponse(BaseModel):
    dialects: list[str]
