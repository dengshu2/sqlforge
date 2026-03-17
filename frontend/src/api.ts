/** API client for the SQLForge backend. */

const BASE = '/api';

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const msg = data?.detail ?? `Request failed (${res.status})`;
    throw new Error(msg);
  }

  return res.json();
}

export interface FormatResult {
  formatted: string;
  dialect: string;
}

export interface TranspileResult {
  result: string;
  source_dialect: string;
  target_dialect: string;
  warnings: string[];
}

export interface OptimizeResult {
  optimized: string;
  rules_applied: string[];
}

export interface ParseResult {
  ast: ASTNode;
  tables: string[];
  columns: string[];
}

export interface ASTNode {
  type: string;
  sql: string;
  key?: string;
  children?: ASTNode[];
}

export interface DiffResult {
  changes: { type: string; sql: string }[];
  summary: Record<string, number>;
}

export function formatSQL(sql: string, dialect: string, indent = 2): Promise<FormatResult> {
  return post('/format', { sql, dialect, indent });
}

export function transpileSQL(
  sql: string,
  sourceDialect: string,
  targetDialect: string,
  pretty = true,
): Promise<TranspileResult> {
  return post('/transpile', {
    sql,
    source_dialect: sourceDialect,
    target_dialect: targetDialect,
    pretty,
  });
}

export function optimizeSQL(sql: string, dialect: string): Promise<OptimizeResult> {
  return post('/optimize', { sql, dialect });
}

export function parseSQL(sql: string, dialect: string): Promise<ParseResult> {
  return post('/parse', { sql, dialect });
}

export function diffSQL(sourceSql: string, targetSql: string, dialect: string): Promise<DiffResult> {
  return post('/diff', { source_sql: sourceSql, target_sql: targetSql, dialect });
}

export interface LineageResult {
  column: string;
  lineage: { expression: string; source?: string }[];
}

export function lineageSQL(
  sql: string,
  column: string,
  dialect: string,
  schema?: Record<string, Record<string, string>>,
): Promise<LineageResult> {
  return post('/lineage', { sql, column, dialect, schema });
}

export async function fetchDialects(): Promise<string[]> {
  const res = await fetch(`${BASE}/dialects`);
  if (!res.ok) throw new Error('Failed to load dialects');
  const data = await res.json();
  return data.dialects;
}
