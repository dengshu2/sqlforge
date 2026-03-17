# SQLForge

SQL formatting and dialect transpilation powered by [sqlglot](https://github.com/tobymao/sqlglot).

## Features

- **Format** — Pretty-print messy SQL into readable, indented code
- **Transpile** — Convert SQL between 31+ database dialects (MySQL ↔ PostgreSQL ↔ Spark ↔ BigQuery ↔ ...)
- **Optimize** — Apply query optimizations (constant folding, predicate pushdown, star expansion)
- **AST Viewer** — Inspect the abstract syntax tree of any SQL query
- **Diff** — Semantic comparison between SQL statements
- **Lineage** — Trace column-level data origins

## Architecture

```
Frontend (Vite + TypeScript + CodeMirror 6)
    │
    ▼  HTTP REST
Backend (FastAPI + sqlglot)
    ├── /api/format
    ├── /api/transpile
    ├── /api/optimize
    ├── /api/parse
    ├── /api/diff
    └── /api/lineage
```

Single-container deployment: FastAPI serves both the API and the built frontend static files.

## Development

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

## Deployment

```bash
docker compose build
docker compose up -d
```

Container binds to `127.0.0.1:7082`. Configure your reverse proxy (Nginx Proxy Manager) to point `sqlforge.dengshu.ovh` to this port.

## Supported Dialects

BigQuery · ClickHouse · Databricks · Doris · Drill · DuckDB · Hive · Materialize · MySQL · Oracle · PostgreSQL · Presto · Redshift · Snowflake · Spark · SQLite · StarRocks · Tableau · Teradata · Trino · T-SQL

## License

MIT
