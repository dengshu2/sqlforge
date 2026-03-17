"""Tests for the sqlglot engine wrapper."""

import pytest
from sqlforge.engine import (
    format_sql,
    transpile_sql,
    parse_sql,
    diff_sql,
    lineage_sql,
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


class TestLineage:
    def test_basic_lineage(self):
        sql = "SELECT u.id, u.name FROM users u"
        mappings = lineage_sql(sql)
        assert len(mappings) == 2
        outputs = [m["output"] for m in mappings]
        assert "id" in outputs
        assert "name" in outputs

    def test_cte_traversal(self):
        sql = """WITH active AS (
            SELECT id, name FROM users WHERE status = 'active'
        ) SELECT id FROM active"""
        mappings = lineage_sql(sql)
        assert len(mappings) >= 1
        assert mappings[0]["source_table"] is not None
        assert "users" in mappings[0]["source_table"]

    def test_multi_source(self):
        sql = "SELECT u.id, o.amount FROM users u JOIN orders o ON u.id = o.user_id"
        mappings = lineage_sql(sql)
        tables = {m["source_table"] for m in mappings if m["source_table"]}
        assert any("users" in t for t in tables)
        assert any("orders" in t for t in tables)


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
