# SQLForge

[English](./README.md)

格式化 SQL，并在 27 种方言之间转换（Hive、Spark、ClickHouse、MySQL、PostgreSQL、Trino 等），同时给出语法树、字段血缘和结构对比。基于 [sqlglot](https://github.com/tobymao/sqlglot)。

**在线使用 → [sqlforge.dengshu.ovh](https://sqlforge.dengshu.ovh)**

## 功能

- **格式化**：整段脚本逐条语句排版，保留原来的函数名（Hive 的 `NVL` 还是 `NVL`）。
- **转换**：改写成目标方言，列出换了写法的函数；如果 sqlglot 在结果里留下了它自己的内部函数名（比如 `TS_OR_DS_ADD`），会提醒需要手动改。
- **错误就地提示**：解析出错时给出行号和列号，并在编辑器里标出那一行。
- **分析**：语法树；每个输出字段来自哪张表的哪一列（能穿过 CTE、子查询、JOIN 和 UNION）；输入和结果之间的结构改动。
- **记住和分享**：上次的输入和方言保存在本机；分享链接把 SQL 放在网址的 `#` 后面，不会发到服务器。

## API

页面上的操作都是 JSON 接口，交互文档在 `/api/docs`。

| 接口 | 请求 | 返回 |
|---|---|---|
| `POST /api/format` | `sql`、`dialect`、`indent` | `formatted` |
| `POST /api/transpile` | `sql`、`source_dialect`、`target_dialect`、`pretty`、`identify` | `result`、`warnings`、`rewritten_functions`、`untranslated_functions` |
| `POST /api/analyze` | `sql`、`dialect`，可选 `target_sql` + `target_dialect` | `ast`、`tables`、`columns`、`lineage`、`diff`、`errors` |
| `POST /api/parse`、`/api/lineage`、`/api/diff` | analyze 的单项 | |
| `GET /api/dialects` | | 方言列表 |

方言留空表示 sqlglot 的通用 SQL。每次请求的 SQL 最多 100,000 字符；每个访问者可以连续发 30 次，之后每秒恢复 1 次，超出返回 429 和 `Retry-After`。出错时返回 `{"detail": "...", "errors": [{"line", "col", "description"}]}`。

## 本地开发

```bash
# 后端，端口 8000
cd backend
uv sync
uv run uvicorn sqlforge.main:app --reload --port 8000
uv run pytest

# 前端，端口 5173，/api 代理到 8000
cd frontend
npm install
npm run dev
npm test
```

## 部署

一个容器同时提供 API 和页面：

```bash
docker compose up -d --build
```

监听 `127.0.0.1:7082`，放在反向代理后面。环境变量：

| 变量 | 作用 |
|---|---|
| `CLIENT_IP_HEADER` | 代理写入访问者地址的请求头（比如 `X-Real-IP`），限流按它计算；不设则用连接地址。 |
| `ANALYTICS_ORIGINS` | 页面的 Content-Security-Policy 额外允许的统计脚本和上报地址。 |
| `RATE_PER_SECOND`、`RATE_BURST` | 接口限流（默认 1 和 30）。 |
| `VITE_UMAMI_WEBSITE_ID` | 构建参数，Umami 统计的站点 ID。 |

## 技术栈

Python 3.13、FastAPI、sqlglot · TypeScript、Vite、CodeMirror 6 · Quiet UI 样式。

## 许可

MIT
