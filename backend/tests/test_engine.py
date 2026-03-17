"""Tests for the sqlglot engine wrapper."""

import pytest
from sqlforge.engine import (
    format_sql,
    transpile_sql,
    optimize_sql,
    parse_sql,
    diff_sql,
)


class TestFormat:
    def test_basic_formatting(self):
        result = format_sql("select a, b from t where x > 1", "mysql")
        assert "SELECT" in result
        assert "FROM" in result
        assert "WHERE" in result

    def test_format_preserves_semantics(self):
        sql = "SELECT id, name FROM users WHERE active = 1"
        result = format_sql(sql)
        lines = result.strip().split("\n")
        assert len(lines) > 1

    def test_format_with_cte(self):
        sql = "WITH active AS (SELECT * FROM users WHERE active = 1) SELECT * FROM active"
        result = format_sql(sql)
        assert "WITH" in result
        assert "active" in result


class TestTranspile:
    def test_duckdb_to_hive(self):
        result, warnings = transpile_sql(
            "SELECT EPOCH_MS(1618088028295)",
            "duckdb",
            "hive",
        )
        assert "FROM_UNIXTIME" in result

    def test_mysql_to_postgres(self):
        result, _ = transpile_sql(
            "SELECT IFNULL(a, b) FROM t",
            "mysql",
            "postgres",
        )
        assert "COALESCE" in result

    def test_identity_transpile(self):
        sql = "SELECT 1"
        result, _ = transpile_sql(sql, "", "")
        assert "1" in result


class TestOptimize:
    def test_basic_optimization(self):
        sql = "SELECT * FROM t WHERE 1 = 1 AND x > 5"
        result, rules = optimize_sql(sql)
        assert "x > 5" in result or "x" in result

    def test_with_schema(self):
        sql = "SELECT * FROM users WHERE id = 1"
        schema = {"users": {"id": "INT", "name": "VARCHAR"}}
        result, _ = optimize_sql(sql, schema=schema)
        assert result


class TestParse:
    def test_basic_parse(self):
        ast, tables, columns = parse_sql("SELECT a, b FROM t WHERE x > 1")
        assert ast["type"] == "Select"
        assert "t" in tables
        assert len(columns) > 0

    def test_join_tables(self):
        sql = "SELECT u.id FROM users u JOIN orders o ON u.id = o.user_id"
        _, tables, _ = parse_sql(sql)
        assert any("users" in t for t in tables)
        assert any("orders" in t for t in tables)


class TestDiff:
    def test_basic_diff(self):
        changes, summary = diff_sql(
            "SELECT a, b FROM t",
            "SELECT a, c FROM t",
        )
        assert len(changes) > 0
        assert isinstance(summary, dict)

    def test_identical(self):
        sql = "SELECT 1"
        changes, summary = diff_sql(sql, sql)
        assert summary.get("removed", 0) == 0
        assert summary.get("inserted", 0) == 0
