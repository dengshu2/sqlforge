# SQLForge

[English](./README.md)

基于 [sqlglot](https://github.com/tobymao/sqlglot) 的 SQL 格式化、方言转换与列级血缘分析工具。

**在线体验 → [sqlforge.dengshu.ovh](https://sqlforge.dengshu.ovh)**

## 功能特性

- **格式化 (Format)** — 将杂乱的 SQL 格式化为可读、规范的缩进代码
- **方言转换 (Transpile)** — 在 31+ 种数据库方言之间自动转换 SQL（MySQL ↔ PostgreSQL ↔ Spark ↔ BigQuery ↔ ...）
- **列级血缘 (Lineage)** — 自动追踪 SELECT 中每一列的数据来源，支持穿透 CTE、子查询和 JOIN
- **语法树查看 (AST)** — 可视化展示 SQL 的抽象语法树结构
- **语义对比 (Diff)** — 输入与输出 SQL 之间的语义级别差异对比

## 架构

```
前端 (Vite + TypeScript + CodeMirror 6)
    │
    ▼  HTTP REST
后端 (FastAPI + sqlglot)
    ├── /api/format     格式化
    ├── /api/transpile   方言转换
    ├── /api/parse       语法解析
    ├── /api/diff        语义对比
    └── /api/lineage     血缘分析
```

单容器部署：FastAPI 同时提供 API 和前端静态资源服务。

## 快速开始

### 本地开发

```bash
# 后端
cd backend
uv sync
uv run uvicorn sqlforge.main:app --reload --port 8000

# 前端（另开一个终端）
cd frontend
npm install
npm run dev
```

Vite 开发服务器会自动将 `/api` 请求代理到 `localhost:8000`。

### Docker 部署

```bash
docker compose build
docker compose up -d
```

容器监听 `127.0.0.1:7082`，通过反向代理（如 Nginx Proxy Manager）将域名指向该端口即可。

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Vite、TypeScript、CodeMirror 6 |
| 后端 | Python 3.13、FastAPI、sqlglot |
| 部署 | Docker 单容器 |

## 支持的 SQL 方言

BigQuery · ClickHouse · Databricks · Doris · Drill · DuckDB · Hive · Materialize · MySQL · Oracle · PostgreSQL · Presto · Redshift · Snowflake · Spark · SQLite · StarRocks · Tableau · Teradata · Trino · T-SQL 等。

## 许可

MIT
