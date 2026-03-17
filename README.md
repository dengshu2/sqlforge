# SQLForge

[中文文档](./README_CN.md)

SQL formatting, dialect transpilation, and column-level lineage analysis — powered by [sqlglot](https://github.com/tobymao/sqlglot).

**Live demo → [sqlforge.dengshu.ovh](https://sqlforge.dengshu.ovh)**

## Features

- **Format** — Pretty-print messy SQL into readable, indented code
- **Transpile** — Convert SQL between 31+ database dialects (MySQL ↔ PostgreSQL ↔ Spark ↔ BigQuery ↔ ...)
- **Lineage** — Automatically trace column-level data origins across CTEs, subqueries, and JOINs
- **AST Viewer** — Inspect the abstract syntax tree of any SQL query
- **Diff** — Semantic comparison between input and output SQL

## Architecture

```
Frontend (Vite + TypeScript + CodeMirror 6)
    │
    ▼  HTTP REST
Backend (FastAPI + sqlglot)
    ├── /api/format
    ├── /api/transpile
    ├── /api/parse
    ├── /api/diff
    └── /api/lineage
```

Single-container deployment: FastAPI serves both the API and the built frontend static files.

## Quick Start

### Development

```bash
# Backend
cd backend
uv sync
uv run uvicorn sqlforge.main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

The Vite dev server proxies `/api` requests to `localhost:8000`.

### Docker

```bash
docker compose build
docker compose up -d
```

Container binds to `127.0.0.1:7082`. Configure your reverse proxy to point your domain to this port.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vite, TypeScript, CodeMirror 6 |
| Backend | Python 3.13, FastAPI, sqlglot |
| Deployment | Docker, single-container |

## Supported Dialects

BigQuery · ClickHouse · Databricks · Doris · Drill · DuckDB · Hive · Materialize · MySQL · Oracle · PostgreSQL · Presto · Redshift · Snowflake · Spark · SQLite · StarRocks · Tableau · Teradata · Trino · T-SQL — and more.

## License

MIT
