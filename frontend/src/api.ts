/** Client for the SQLForge API. Failures become ApiError with a message that
 * can be shown as is, plus the parse position when the SQL itself was wrong. */

export interface ErrorPosition {
  line: number | null;
  col: number | null;
  description: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly positions: ErrorPosition[] = [],
  ) {
    super(message);
  }
}

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError('网络连接失败，请稍后重试', 0);
  }
  if (res.ok) return res.json();
  const data = await res.json().catch(() => null);
  if (res.status === 429) throw new ApiError('请求太频繁，请稍等几秒再试', 429);
  if (res.status === 422 && data?.detail) throw new ApiError(String(data.detail), 422, data.errors ?? []);
  throw new ApiError(`服务暂时不可用（${res.status}）`, res.status);
}

export interface TranspileResult {
  result: string;
  warnings: string[];
  rewritten_functions: string[];
  untranslated_functions: string[];
}

export interface ASTNode {
  type: string;
  sql: string;
  key?: string | null;
  truncated?: boolean | null;
  children?: ASTNode[] | null;
}

export interface LineageRow {
  output: string;
  expression: string;
  source_table: string | null;
  source_column: string | null;
  statement?: number | null;
}

export interface DiffChange {
  type: 'remove' | 'insert' | 'move' | 'update';
  sql: string;
  target?: string | null;
}

export interface Analysis {
  ast: ASTNode | null;
  tables: string[];
  columns: string[];
  lineage: LineageRow[];
  diff: { changes: DiffChange[]; summary: Record<string, number> } | null;
  errors: Partial<Record<'ast' | 'lineage' | 'diff', string>>;
}

export const formatSQL = (sql: string, dialect: string, signal?: AbortSignal) =>
  post<{ formatted: string }>('/format', { sql, dialect }, signal);

export const transpileSQL = (sql: string, from: string, to: string, signal?: AbortSignal) =>
  post<TranspileResult>('/transpile', { sql, source_dialect: from, target_dialect: to }, signal);

export const analyzeSQL = (
  sql: string,
  dialect: string,
  target?: { sql: string; dialect: string },
  signal?: AbortSignal,
) =>
  post<Analysis>(
    '/analyze',
    { sql, dialect, target_sql: target?.sql ?? null, target_dialect: target?.dialect ?? null },
    signal,
  );
