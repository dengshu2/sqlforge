# SQLForge

[中文](./README_CN.md)

Format SQL and convert it between 27 dialects (Hive, Spark, ClickHouse, MySQL, PostgreSQL, Trino and more), with the syntax tree, column lineage and a structural diff alongside. Powered by [sqlglot](https://github.com/tobymao/sqlglot).

**Try it → [sqlforge.dengshu.ovh](https://sqlforge.dengshu.ovh)**

## What it does

- **Format**: pretty-prints a whole script, statement by statement, keeping your function names (Hive's `NVL` stays `NVL`).
- **Convert**: rewrites the script for another dialect, lists the functions it spelled differently, and warns when sqlglot left one of its own internal names (such as `TS_OR_DS_ADD`) in the output.
- **Errors in place**: a parse error is shown with its line and column, and the line is marked in the editor.
- **Analysis**: syntax tree, where each output column comes from (through CTEs, subqueries, joins and unions), and what changed structurally between input and result.
- **Remembers and shares**: the last input and dialects stay on the device; a share link carries the SQL in the URL fragment, which never reaches the server.

## API

Everything the page does is a JSON call; interactive docs are at `/api/docs`.

| Endpoint | Body | Returns |
|---|---|---|
| `POST /api/format` | `sql`, `dialect`, `indent` | `formatted` |
| `POST /api/transpile` | `sql`, `source_dialect`, `target_dialect`, `pretty`, `identify` | `result`, `warnings`, `rewritten_functions`, `untranslated_functions` |
| `POST /api/analyze` | `sql`, `dialect`, optional `target_sql` + `target_dialect` | `ast`, `tables`, `columns`, `lineage`, `diff`, `errors` |
| `POST /api/parse`, `/api/lineage`, `/api/diff` | the single parts of analyze | |
| `GET /api/dialects` | | the dialect names |

An empty dialect means sqlglot's generic SQL. SQL is limited to 100,000 characters per request, and each client to 30 requests at once, refilled at one per second (HTTP 429 with `Retry-After` past that). Errors come back as `{"detail": "...", "errors": [{"line", "col", "description"}]}`.

## Development

```bash
# Backend on :8000
cd backend
uv sync
uv run uvicorn sqlforge.main:app --reload --port 8000
uv run pytest

# Frontend on :5173, proxying /api to :8000
cd frontend
npm install
npm run dev
npm test
```

## Deployment

One container serves the API and the built page:

```bash
docker compose up -d --build
```

It listens on `127.0.0.1:7082` behind a reverse proxy. Settings (environment):

| Variable | Meaning |
|---|---|
| `CLIENT_IP_HEADER` | Header carrying the visitor's address, set by the proxy (e.g. `X-Real-IP`); the rate limit keys on it. Unset: the connecting address. |
| `ANALYTICS_ORIGINS` | Extra origins the page's Content-Security-Policy allows for scripts and beacons. |
| `RATE_PER_SECOND`, `RATE_BURST` | The API rate limit (default 1 and 30). |
| `VITE_UMAMI_WEBSITE_ID` | Build argument for the Umami analytics snippet. |

## Stack

Python 3.13, FastAPI, sqlglot · TypeScript, Vite, CodeMirror 6 · Quiet UI styles.

## License

MIT
