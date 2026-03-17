"""Thin wrapper around sqlglot for all SQL operations."""

from __future__ import annotations

import sqlglot
from sqlglot import parse_one, diff, exp, Dialect
from sqlglot.errors import ErrorLevel
from sqlglot.optimizer import optimize

# Cache for format-specific dialect variants that preserve original function names.
_format_dialect_cache: dict[str, str] = {}


def _dialect_or_none(d: str) -> str | None:
    return d if d else None


def _get_format_dialect(dialect_name: str) -> str:
    """Return a format-specific dialect name with PRESERVE_ORIGINAL_NAMES enabled.

    sqlglot normalizes dialect-specific function names during parse→generate
    (e.g. Hive's NVL becomes COALESCE). For formatting we want to keep the
    user's original function names intact, so we create a thin dialect subclass
    with PRESERVE_ORIGINAL_NAMES = True and cache it for reuse.
    """
    if dialect_name in _format_dialect_cache:
        return _format_dialect_cache[dialect_name]

    base_cls = type(Dialect.get_or_raise(dialect_name))

    format_cls = type(
        f"{base_cls.__name__}Format",
        (base_cls,),
        {"PRESERVE_ORIGINAL_NAMES": True},
    )

    format_name = f"{dialect_name}__format"
    Dialect.classes[format_name] = format_cls
    _format_dialect_cache[dialect_name] = format_name
    return format_name


def format_sql(sql: str, dialect: str = "", indent: int = 2) -> str:
    """Format SQL with pretty-printing, preserving original function names."""
    fmt = _get_format_dialect(dialect or "")
    tree = parse_one(sql, dialect=fmt)
    return tree.sql(dialect=fmt, pretty=True, indent=indent)


def transpile_sql(
    sql: str,
    source_dialect: str = "",
    target_dialect: str = "",
    pretty: bool = True,
    identify: bool = False,
) -> tuple[str, list[str]]:
    """Transpile SQL between dialects. Returns (result, warnings)."""
    results = sqlglot.transpile(
        sql,
        read=_dialect_or_none(source_dialect),
        write=_dialect_or_none(target_dialect),
        pretty=pretty,
        identify=identify,
        error_level=ErrorLevel.WARN,
    )
    return results[0] if results else "", []


def optimize_sql(
    sql: str,
    dialect: str = "",
    schema: dict | None = None,
) -> tuple[str, list[str]]:
    """Optimize SQL query. Returns (optimized_sql, rules_applied)."""
    d = _dialect_or_none(dialect)
    tree = parse_one(sql, dialect=d)

    rules_applied: list[str] = []
    kwargs: dict = {"dialect": d} if d else {}
    if schema:
        kwargs["schema"] = schema

    try:
        optimized = optimize(tree, **kwargs)
        original_str = tree.sql(dialect=d)
        optimized_str = optimized.sql(dialect=d, pretty=True)

        if original_str != optimized_str:
            rules_applied = _detect_applied_rules(tree, optimized)

        return optimized_str, rules_applied
    except Exception:
        return tree.sql(dialect=d, pretty=True), ["optimization_skipped"]


def _detect_applied_rules(original: exp.Expression, optimized: exp.Expression) -> list[str]:
    """Heuristic detection of optimization rules that were applied."""
    rules = []

    orig_sql = original.sql()
    opt_sql = optimized.sql()

    if "*" in orig_sql and "*" not in opt_sql:
        rules.append("expand_star")
    if orig_sql.count("SELECT") > opt_sql.count("SELECT"):
        rules.append("merge_subqueries")
    if "1 = 1" in orig_sql or "TRUE" in orig_sql.upper():
        rules.append("simplify_predicates")
    if not rules:
        rules.append("general_optimization")

    return rules


def parse_sql(sql: str, dialect: str = "") -> tuple[dict, list[str], list[str]]:
    """Parse SQL and return AST, tables, columns."""
    d = _dialect_or_none(dialect)
    tree = parse_one(sql, dialect=d)

    ast_dict = _expression_to_dict(tree)

    tables: list[str] = []
    for node in tree.find_all(exp.Table):
        table_name = node.sql(dialect=d)
        if table_name:
            tables.append(table_name)

    col_set: set[str] = set()
    for node in tree.find_all(exp.Column):
        col_name = node.sql(dialect=d)
        if col_name:
            col_set.add(col_name)
    columns = sorted(col_set)

    return ast_dict, tables, columns


def _expression_to_dict(node: exp.Expression, depth: int = 0) -> dict:
    """Convert sqlglot AST to a JSON-serializable dict."""
    if depth > 20:
        return {"type": type(node).__name__, "sql": node.sql()}

    result: dict = {
        "type": type(node).__name__,
        "sql": node.sql(),
    }

    children = []
    for key, val in node.args.items():
        if isinstance(val, exp.Expression):
            children.append({
                "key": key,
                **_expression_to_dict(val, depth + 1),
            })
        elif isinstance(val, list):
            for item in val:
                if isinstance(item, exp.Expression):
                    children.append({
                        "key": key,
                        **_expression_to_dict(item, depth + 1),
                    })

    if children:
        result["children"] = children

    return result


def diff_sql(
    source_sql: str,
    target_sql: str,
    dialect: str = "",
) -> tuple[list[dict], dict]:
    """Compare two SQL queries and return changes."""
    d = _dialect_or_none(dialect)
    source = parse_one(source_sql, dialect=d)
    target = parse_one(target_sql, dialect=d)

    changes = diff(source, target)

    result: list[dict] = []
    summary = {"kept": 0, "removed": 0, "inserted": 0, "moved": 0}

    for change in changes:
        kind = type(change).__name__.lower()
        entry: dict = {"type": kind}

        if kind == "keep":
            entry["sql"] = change.source.sql(dialect=d)
            summary["kept"] += 1
        elif kind == "remove":
            entry["sql"] = change.expression.sql(dialect=d)
            summary["removed"] += 1
        elif kind == "insert":
            entry["sql"] = change.expression.sql(dialect=d)
            summary["inserted"] += 1
        elif kind == "move":
            entry["sql"] = change.expression.sql(dialect=d)
            summary["moved"] += 1

        result.append(entry)

    return result, summary


def lineage_sql(
    sql: str,
    column: str,
    dialect: str = "",
    schema: dict | None = None,
) -> list[dict]:
    """Trace column lineage. Returns a list of lineage nodes."""
    from sqlglot.lineage import lineage

    d = _dialect_or_none(dialect)
    kwargs: dict = {}
    if d:
        kwargs["dialect"] = d
    if schema:
        kwargs["schema"] = schema

    try:
        node = lineage(column, sql, **kwargs)
        return _lineage_to_list(node)
    except Exception as e:
        return [{"source": str(e), "expression": column}]


def _lineage_to_list(node) -> list[dict]:
    """Flatten lineage tree to a list."""
    result: list[dict] = []

    entry = {
        "expression": node.expression.sql() if hasattr(node, "expression") else str(node),
    }
    if hasattr(node, "source") and node.source:
        entry["source"] = node.source.sql()

    result.append(entry)

    if hasattr(node, "downstream"):
        for child in node.downstream:
            result.extend(_lineage_to_list(child))

    return result
