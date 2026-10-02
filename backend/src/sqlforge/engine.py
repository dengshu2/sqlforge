"""SQL operations on top of sqlglot.

Every operation takes a whole script: statements are parsed one by one and
written back joined by semicolons, so nothing after the first statement is
dropped. Parse errors carry line and column so the page can point at them.
"""

from __future__ import annotations

import re
from itertools import zip_longest

import sqlglot
from sqlglot import Dialect, exp
from sqlglot.diff import diff as ast_diff
from sqlglot.errors import ErrorLevel, ParseError, TokenError
from sqlglot.lineage import lineage as trace_lineage
from sqlglot.tokens import TokenType

MAX_AST_NODES = 1500  # beyond this the tree is cut off and marked truncated
MAX_AST_DEPTH = 24
MAX_PREVIEW = 160  # characters of SQL shown next to each tree node
MAX_DIFF_CHARS = 20_000  # tree diffing grows quickly with size
MAX_LINEAGE_COLUMNS = 200


# Names sqlglot gives functions it could not spell in the target dialect
# (Hive's DATE_SUB comes out of ClickHouse as TS_OR_DS_ADD). No database has
# them, so one in the output means the conversion needs a hand.
_INTERNAL_NAME = re.compile(
    r"^(TS_OR_D[SI]_\w+|\w+_STR_TO_\w+|UNIX_TO_\w+|STR_TO_(UNIX|TIME)|TIME_TO_(STR|UNIX|TIME_STR)"
    r"|DATE_TO_(DI|DATE_STR)|DI_TO_DATE|ARRAY_UNIQUE_AGG)$"
)
INTERNAL_FUNCTIONS = frozenset(n for f in exp.ALL_FUNCTIONS for n in f.sql_names() if _INTERNAL_NAME.match(n))


class SQLError(Exception):
    """SQL that sqlglot could not read; positions are 1-based."""

    def __init__(self, message: str, errors: list[dict] | None = None):
        super().__init__(message)
        self.errors = errors or []


def _dialect(name: str) -> str | None:
    return name or None


# Formatting keeps the user's own function names (Hive's NVL stays NVL instead
# of becoming COALESCE), which takes a dialect subclass with
# PRESERVE_ORIGINAL_NAMES on. One is made per dialect and registered by name.
_format_dialects: dict[str, str] = {}


def _format_dialect(name: str) -> str:
    if name not in _format_dialects:
        base = type(Dialect.get_or_raise(name or None))
        cls = type(f"{base.__name__}Format", (base,), {"PRESERVE_ORIGINAL_NAMES": True})
        key = f"{name or 'generic'}__format"
        Dialect.classes[key] = cls
        _format_dialects[name] = key
    return _format_dialects[name]


def _parse(sql: str, dialect: str | None) -> list[exp.Expr]:
    try:
        trees = sqlglot.parse(sql, read=dialect)
    except ParseError as e:
        errors = [
            {"line": err.get("line"), "col": err.get("col"), "description": err.get("description") or ""}
            for err in e.errors
        ]
        first = errors[0] if errors else None
        message = first["description"] if first and first["description"] else str(e)
        raise SQLError(message, errors) from None
    except TokenError as e:
        raise SQLError(str(e)) from None
    # A trailing "-- comment" or a stray ";" parses as a Semicolon node.
    statements = [t for t in trees if t is not None and not (isinstance(t, exp.Semicolon) and not t.comments)]
    if not statements:
        raise SQLError("No SQL statement found")
    return statements


def _join(parts: list[str], sql: str) -> str:
    """Join statements back into a script. A single statement keeps its
    trailing semicolon only if the input had one."""
    parts = [p for p in parts if p.strip()]
    if len(parts) == 1 and not sql.rstrip().endswith(";"):
        return parts[0]
    return ";\n\n".join(parts) + ";"


def format_sql(sql: str, dialect: str = "", indent: int = 2) -> str:
    fmt = _format_dialect(dialect)
    trees = _parse(sql, fmt)
    # pad is sqlglot's indent width; its own indent option is the starting level.
    return _join([t.sql(dialect=fmt, pretty=True, pad=indent) for t in trees], sql)


def transpile_sql(
    sql: str,
    source_dialect: str = "",
    target_dialect: str = "",
    pretty: bool = True,
    identify: bool = False,
) -> dict:
    """Returns {result, warnings, rewritten_functions, untranslated_functions}.

    warnings are constructs the target dialect cannot express (sqlglot's
    "unsupported" messages); rewritten_functions are function names from the
    input that no longer appear in the output, such as NVL → COALESCE;
    untranslated_functions are sqlglot-internal names left in the output.
    """
    trees = _parse(sql, _dialect(source_dialect))
    target = Dialect.get_or_raise(_dialect(target_dialect))
    parts: list[str] = []
    warnings: list[str] = []
    for tree in trees:
        gen = target.generator(pretty=pretty, identify=identify, unsupported_level=ErrorLevel.IGNORE)
        parts.append(gen.generate(tree, copy=True))
        for msg in gen.unsupported_messages:
            if msg not in warnings:
                warnings.append(msg)
    result = _join(parts, sql)

    before = _function_names(sql, source_dialect)
    after = _function_names(result, target_dialect)
    rewritten = sorted(before - after) if target_dialect and source_dialect != target_dialect else []
    return {
        "result": result,
        "warnings": warnings,
        "rewritten_functions": rewritten,
        "untranslated_functions": sorted((after & INTERNAL_FUNCTIONS) - before),
    }


def _function_names(sql: str, dialect: str) -> set[str]:
    """Names used as function calls. Tokenizing (rather than a regex) skips
    strings and comments."""
    d = Dialect.get_or_raise(_dialect(dialect))
    known = d.parser_class.FUNCTIONS
    try:
        tokens = d.tokenize(sql)
    except TokenError:
        return set()
    names = set()
    for tok, nxt in zip(tokens, tokens[1:]):
        if nxt.token_type != TokenType.L_PAREN:
            continue
        name = tok.text.upper()
        if tok.token_type == TokenType.VAR or name in known:
            names.add(name)
    return names


# ── Analysis ────────────────────────────────────────────────────────────────


def parse_sql(sql: str, dialect: str = "") -> tuple[dict, list[str], list[str]]:
    """Returns (ast, tables, columns). Several statements hang under one
    Statements node."""
    d = _dialect(dialect)
    trees = _parse(sql, d)
    return _ast(trees, d), _tables(trees, d), _columns(trees, d)


def _ast(trees: list[exp.Expr], d: str | None) -> dict:
    budget = [MAX_AST_NODES]
    if len(trees) == 1:
        return _node(trees[0], d, 0, budget)
    return {
        "type": "Statements",
        "sql": f"{len(trees)} statements",
        "children": [{"key": "statement", **_node(t, d, 1, budget)} for t in trees],
    }


def _node(node: exp.Expr, d: str | None, depth: int, budget: list[int]) -> dict:
    budget[0] -= 1
    text = node.sql(dialect=d)
    out: dict = {
        "type": type(node).__name__,
        "sql": text if len(text) <= MAX_PREVIEW else text[: MAX_PREVIEW - 1] + "…",
    }
    children = []
    for key, value in node.args.items():
        for child in value if isinstance(value, list) else [value]:
            if not isinstance(child, exp.Expr):
                continue
            if depth >= MAX_AST_DEPTH or budget[0] <= 0:
                out["truncated"] = True
                break
            children.append({"key": key, **_node(child, d, depth + 1, budget)})
    if children:
        out["children"] = children
    return out


def _tables(trees: list[exp.Expr], d: str | None) -> list[str]:
    seen: list[str] = []
    for tree in trees:
        for table in tree.find_all(exp.Table):
            name = exp.table_name(table, dialect=d)
            if name and name not in seen:
                seen.append(name)
    return seen


def _columns(trees: list[exp.Expr], d: str | None) -> list[str]:
    return sorted({c.sql(dialect=d) for tree in trees for c in tree.find_all(exp.Column)} - {""})


def lineage_sql(sql: str, dialect: str = "", schema: dict | None = None) -> list[dict]:
    d = _dialect(dialect)
    return _lineage(_parse(sql, d), d, schema)


def _lineage(trees: list[exp.Expr], d: str | None, schema: dict | None) -> list[dict]:
    """Where each output column comes from: one row per (output, source column).
    Statements without a query (DDL, plain INSERT ... VALUES) are skipped."""
    rows: list[dict] = []
    numbered = len(trees) > 1
    for index, tree in enumerate(trees, 1):
        query = _query_of(tree)
        if query is None:
            continue
        try:
            nodes = trace_lineage(None, query, schema=schema, dialect=d)
        except Exception:
            continue  # sqlglot cannot resolve this one; skip it, keep the rest
        for output, node in list(nodes.items())[:MAX_LINEAGE_COLUMNS]:
            expr = node.expression.this if isinstance(node.expression, exp.Alias) else node.expression
            base = {"output": output, "expression": expr.sql(dialect=d)}
            if numbered:
                base["statement"] = index
            sources = _sources(node, d)
            if not sources:
                rows.append({**base, "source_table": None, "source_column": None})
            for table, column in sources:
                rows.append({**base, "source_table": table, "source_column": column})
    return rows


def _query_of(tree: exp.Expr) -> exp.Query | None:
    if isinstance(tree, exp.Query):
        return tree
    inner = tree.args.get("expression")  # INSERT ... SELECT, CREATE TABLE ... AS
    if isinstance(inner, exp.Query):
        return inner
    return None


def _sources(node, d: str | None) -> list[tuple[str, str]]:
    found: list[tuple[str, str]] = []
    for leaf in node.walk():
        if leaf.downstream or not isinstance(leaf.source, exp.Table):
            continue
        pair = (exp.table_name(leaf.source, dialect=d), leaf.name.rsplit(".", 1)[-1])
        if pair not in found:
            found.append(pair)
    return found


def diff_sql(
    source_sql: str,
    target_sql: str,
    dialect: str = "",
    target_dialect: str | None = None,
) -> tuple[list[dict], dict]:
    """Structural changes from source to target, statement by statement. The
    target is read with its own dialect when it was transpiled into one."""
    d = _dialect(dialect)
    td = _dialect(target_dialect) if target_dialect is not None else d
    if len(source_sql) > MAX_DIFF_CHARS or len(target_sql) > MAX_DIFF_CHARS:
        raise SQLError(f"Diff is limited to {MAX_DIFF_CHARS:,} characters per side")
    return _diff(_parse(source_sql, d), _parse(target_sql, td), d, td)


def _diff(sources: list[exp.Expr], targets: list[exp.Expr], d: str | None, td: str | None) -> tuple[list[dict], dict]:
    changes: list[dict] = []
    summary = {"kept": 0, "removed": 0, "inserted": 0, "moved": 0, "updated": 0}
    for source, target in zip_longest(sources, targets):
        if target is None:
            changes.append({"type": "remove", "sql": _short(source.sql(dialect=d))})
            summary["removed"] += 1
            continue
        if source is None:
            changes.append({"type": "insert", "sql": _short(target.sql(dialect=td))})
            summary["inserted"] += 1
            continue
        for edit in ast_diff(source, target):
            kind = type(edit).__name__.lower()
            if kind == "keep":
                summary["kept"] += 1
                continue
            if kind == "update":
                entry = {"type": kind, "sql": _short(edit.source.sql(dialect=d)), "target": _short(edit.target.sql(dialect=td))}
            elif kind == "move":
                entry = {"type": kind, "sql": _short(edit.target.sql(dialect=td))}
            else:
                side = td if kind == "insert" else d
                entry = {"type": kind, "sql": _short(edit.expression.sql(dialect=side))}
            changes.append(entry)
            summary[{"remove": "removed", "insert": "inserted", "move": "moved", "update": "updated"}[kind]] += 1
    return changes, summary


def _short(text: str, limit: int = 240) -> str:
    return text if len(text) <= limit else text[: limit - 1] + "…"


def analyze_sql(
    sql: str,
    dialect: str = "",
    target_sql: str | None = None,
    target_dialect: str | None = None,
) -> dict:
    """Tree, tables, columns, lineage and (given a target) the diff in one go.
    The input is parsed once; a part that fails is reported in errors and the
    others still come back."""
    d = _dialect(dialect)
    trees = _parse(sql, d)
    out: dict = {"ast": None, "tables": [], "columns": [], "lineage": [], "diff": None, "errors": {}}
    try:
        out["ast"] = _ast(trees, d)
        out["tables"] = _tables(trees, d)
        out["columns"] = _columns(trees, d)
    except Exception as e:
        out["errors"]["ast"] = str(e)
    try:
        out["lineage"] = _lineage(trees, d, None)
    except Exception as e:
        out["errors"]["lineage"] = str(e)
    if target_sql:
        try:
            changes, summary = diff_sql(sql, target_sql, dialect, target_dialect)
            out["diff"] = {"changes": changes, "summary": summary}
        except Exception as e:
            out["errors"]["diff"] = str(e)
    return out
