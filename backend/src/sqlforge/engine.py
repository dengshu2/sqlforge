"""Thin wrapper around sqlglot for all SQL operations."""

from __future__ import annotations

from sqlglot import parse_one, diff, exp, Dialect

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
    """Transpile SQL between dialects. Returns (result, warnings).

    Warnings are generated when dialect-specific constructs are rewritten
    during transpilation (e.g. NVL → COALESCE, ISNULL → COALESCE).
    """
    import re

    source_d = _dialect_or_none(source_dialect)
    target_d = _dialect_or_none(target_dialect)

    tree = parse_one(sql, dialect=source_d)
    result = tree.sql(dialect=target_d, pretty=pretty, identify=identify)

    # Detect rewritten constructs by comparing function-call names in raw text.
    # sqlglot normalises dialect aliases (e.g. NVL → COALESCE) at parse time,
    # so AST-level comparison cannot detect them — raw text must be compared.
    warnings: list[str] = []
    if target_d and source_d != target_d:
        fn_pattern = re.compile(r"\b([A-Z_]\w*)\s*\(", re.IGNORECASE)
        source_funcs = {m.upper() for m in fn_pattern.findall(sql)}
        target_funcs = {m.upper() for m in fn_pattern.findall(result)}

        # Ignore SQL keywords that look like functions (SELECT, FROM, etc.)
        keywords = {"SELECT", "FROM", "WHERE", "GROUP", "ORDER", "HAVING",
                     "LIMIT", "INSERT", "UPDATE", "DELETE", "CREATE", "ALTER",
                     "DROP", "IF", "CASE", "WHEN", "THEN", "ELSE", "END",
                     "AND", "OR", "NOT", "IN", "EXISTS", "BETWEEN", "LIKE",
                     "JOIN", "ON", "AS", "SET", "VALUES", "INTO", "WITH"}
        source_funcs -= keywords
        target_funcs -= keywords

        rewritten = source_funcs - target_funcs
        for fn in sorted(rewritten):
            warnings.append(f"'{fn}' was rewritten for the target dialect")

    return result, warnings





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
    dialect: str = "",
    schema: dict | None = None,
) -> list[dict]:
    """Trace column lineage for ALL output columns automatically.

    Returns a list of mappings, one per output column:
      {output, expression, source_table, source_column}
    """
    from sqlglot.lineage import lineage as trace_lineage

    d = _dialect_or_none(dialect)
    kwargs: dict = {}
    if d:
        kwargs["dialect"] = d
    if schema:
        kwargs["schema"] = schema

    tree = parse_one(sql, dialect=d)
    select = tree.find(exp.Select)
    if not select:
        return []

    output_cols: list[str] = []
    for expr in select.expressions:
        if isinstance(expr, exp.Alias):
            output_cols.append(expr.alias)
        elif isinstance(expr, exp.Column):
            output_cols.append(expr.name)
        else:
            output_cols.append(expr.sql(dialect=d))

    result: list[dict] = []
    for col in output_cols:
        try:
            node = trace_lineage(col, sql, **kwargs)
        except Exception:
            result.append({
                "output": col,
                "expression": col,
                "source_table": None,
                "source_column": None,
            })
            continue

        expr_sql = node.expression.sql(dialect=d) if hasattr(node, "expression") else col
        leaves = _collect_leaves(node)

        if leaves:
            for leaf_name, leaf_table in leaves:
                result.append({
                    "output": col,
                    "expression": expr_sql,
                    "source_table": leaf_table,
                    "source_column": leaf_name,
                })
        else:
            result.append({
                "output": col,
                "expression": expr_sql,
                "source_table": None,
                "source_column": None,
            })

    return result


def _collect_leaves(node) -> list[tuple[str, str]]:
    """Walk lineage tree to leaf nodes, returning (column_name, table_name) pairs."""
    if not hasattr(node, "downstream") or not node.downstream:
        table = ""
        if hasattr(node, "expression") and node.expression:
            table = node.expression.sql()
        col_name = getattr(node, "name", "")
        return [(col_name, table)]

    results: list[tuple[str, str]] = []
    for child in node.downstream:
        results.extend(_collect_leaves(child))
    return results
