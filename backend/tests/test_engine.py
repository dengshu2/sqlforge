"""Tests for the sqlglot wrapper."""

import pytest

from sqlforge.engine import (
    SQLError,
    analyze_sql,
    diff_sql,
    format_sql,
    lineage_sql,
    parse_sql,
    transpile_sql,
)


class TestFormat:
    def test_pretty_prints(self):
        result = format_sql("select a, b from t where x > 1", "mysql")
        assert result.splitlines()[0] == "SELECT"
        assert "WHERE" in result

    def test_keeps_original_function_names(self):
        assert "NVL(" in format_sql("select nvl(a, 0) from t", "hive")

    def test_keeps_every_statement(self):
        result = format_sql("select 1; select 2", "mysql")
        assert result.count("SELECT") == 2
        assert result.endswith(";")

    def test_single_statement_keeps_its_semicolon_choice(self):
        assert not format_sql("select 1").endswith(";")
        assert format_sql("select 1;").endswith(";")

    def test_ignores_stray_semicolons(self):
        assert format_sql("select 1;;\n;").count("SELECT") == 1

    def test_indent(self):
        assert "\n    1" in format_sql("select 1", indent=4)


class TestErrors:
    def test_parse_error_has_position(self):
        with pytest.raises(SQLError) as info:
            format_sql("select a from t where (x = 1", "mysql")
        err = info.value.errors[0]
        assert err["line"] == 1 and err["col"] > 20
        assert "Expecting )" in str(info.value)

    def test_position_on_a_later_line(self):
        with pytest.raises(SQLError) as info:
            transpile_sql("select a\nfrom t\nwhere (x = 1", "mysql", "postgres")
        assert info.value.errors[0]["line"] == 3

    def test_tokenizer_error(self):
        with pytest.raises(SQLError):
            format_sql("select 'abc from t")

    def test_empty_script(self):
        with pytest.raises(SQLError):
            format_sql(";")


class TestTranspile:
    def test_duckdb_to_hive(self):
        assert "FROM_UNIXTIME" in transpile_sql("SELECT EPOCH_MS(1618088028295)", "duckdb", "hive")["result"]

    def test_mysql_to_postgres_reports_rewrite(self):
        out = transpile_sql("SELECT IFNULL(a, b) FROM t", "mysql", "postgres")
        assert "COALESCE" in out["result"]
        assert out["rewritten_functions"] == ["IFNULL"]

    def test_flags_internal_names_left_in_the_output(self):
        out = transpile_sql("SELECT DATE_SUB(CURRENT_DATE, 30)", "hive", "clickhouse")
        assert "TS_OR_DS_ADD" in out["result"]
        assert out["untranslated_functions"] == ["TS_OR_DS_ADD"]
        assert transpile_sql("SELECT DATE_SUB(CURRENT_DATE, 30)", "hive", "spark")["untranslated_functions"] == []

    def test_function_names_inside_strings_are_ignored(self):
        out = transpile_sql("SELECT 'IFNULL(' AS s, a -- NVL(x)\nFROM t", "mysql", "postgres")
        assert out["rewritten_functions"] == []

    def test_every_statement(self):
        out = transpile_sql("select ifnull(a, 1) from t; select ifnull(b, 2) from u;", "mysql", "postgres")
        assert out["result"].count("COALESCE") == 2

    def test_identity(self):
        assert transpile_sql("SELECT 1", "", "")["result"] == "SELECT\n  1"

    def test_identify_quotes(self):
        assert '"a"' in transpile_sql("select a from t", "", "postgres", pretty=False, identify=True)["result"]


class TestParse:
    def test_tables_and_columns(self):
        ast, tables, columns = parse_sql("SELECT u.id, o.total FROM db.users u JOIN orders o ON u.id = o.uid")
        assert ast["type"] == "Select"
        assert tables == ["db.users", "orders"]
        assert "u.id" in columns and "o.total" in columns

    def test_several_statements(self):
        ast, tables, _ = parse_sql("select a from t; select b from u")
        assert ast["type"] == "Statements"
        assert len(ast["children"]) == 2
        assert tables == ["t", "u"]

    def test_tree_is_cut_off(self):
        sql = "SELECT " + ", ".join(f"c{i}" for i in range(3000)) + " FROM t"
        ast, _, _ = parse_sql(sql)
        assert ast.get("truncated")

    def test_preview_is_short(self):
        sql = "SELECT " + ", ".join(f"column_{i}" for i in range(200)) + " FROM t"
        ast, _, _ = parse_sql(sql)
        assert len(ast["sql"]) <= 160


class TestLineage:
    def test_sources(self):
        rows = lineage_sql("SELECT u.id, COALESCE(o.n, 0) AS n, 1 AS one FROM db.users u JOIN orders o ON u.id = o.uid")
        by_output = {r["output"]: r for r in rows}
        assert by_output["id"]["source_table"] == "db.users"
        assert by_output["id"]["source_column"] == "id"
        assert by_output["n"]["expression"] == "COALESCE(o.n, 0)"
        assert by_output["n"]["source_table"] == "orders"
        assert by_output["one"]["source_table"] is None

    def test_union_has_both_sources(self):
        rows = lineage_sql("SELECT a FROM t UNION ALL SELECT b FROM s")
        assert {(r["source_table"], r["source_column"]) for r in rows} == {("t", "a"), ("s", "b")}

    def test_insert_select(self):
        rows = lineage_sql("INSERT INTO x SELECT id FROM users", "hive")
        assert rows[0]["source_table"] == "users"

    def test_statements_are_numbered(self):
        rows = lineage_sql("CREATE TABLE t (a INT); SELECT a FROM t")
        assert rows == [{"output": "a", "expression": "t.a", "statement": 2, "source_table": "t", "source_column": "a"}]


class TestDiff:
    def test_changes(self):
        changes, summary = diff_sql("SELECT a, b FROM t", "SELECT a, c FROM t")
        assert summary["removed"] >= 1 and summary["inserted"] >= 1
        assert all(c["type"] != "keep" for c in changes)

    def test_target_read_with_its_dialect(self):
        # TOP is T-SQL for LIMIT.
        changes, _ = diff_sql("SELECT a FROM t LIMIT 1", "SELECT TOP 1 a FROM t", "", "tsql")
        assert changes == []

    def test_extra_statement(self):
        changes, summary = diff_sql("SELECT 1", "SELECT 1; SELECT 2")
        assert summary["inserted"] == 1
        assert changes[-1] == {"type": "insert", "sql": "SELECT 2"}

    def test_size_limit(self):
        with pytest.raises(SQLError):
            diff_sql("SELECT " + "1 + " * 6000 + "1", "SELECT 1")


class TestAnalyze:
    def test_all_parts(self):
        out = analyze_sql("SELECT IFNULL(a, 0) AS a FROM t", "mysql", "SELECT COALESCE(a, 0) AS a FROM t", "postgres")
        assert out["ast"]["type"] == "Select"
        assert out["tables"] == ["t"]
        assert out["lineage"][0]["source_column"] == "a"
        assert out["diff"]["changes"] == []
        assert out["errors"] == {}

    def test_failing_part_is_reported(self):
        out = analyze_sql("SELECT a FROM t", "", "SELECT (", "")
        assert out["ast"] is not None
        assert "diff" in out["errors"]

    def test_input_error_raises(self):
        with pytest.raises(SQLError):
            analyze_sql("SELECT (")
