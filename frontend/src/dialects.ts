/** Dialect names, and the order the picker lists them in. */

export const LABELS: Record<string, string> = {
  '': '通用 SQL',
  athena: 'Athena',
  bigquery: 'BigQuery',
  clickhouse: 'ClickHouse',
  databricks: 'Databricks',
  doris: 'Doris',
  dremio: 'Dremio',
  drill: 'Drill',
  druid: 'Druid',
  duckdb: 'DuckDB',
  exasol: 'Exasol',
  fabric: 'Fabric',
  hive: 'Hive',
  materialize: 'Materialize',
  mysql: 'MySQL',
  oracle: 'Oracle',
  postgres: 'PostgreSQL',
  presto: 'Presto',
  redshift: 'Redshift',
  risingwave: 'RisingWave',
  snowflake: 'Snowflake',
  spark: 'Spark',
  sqlite: 'SQLite',
  starrocks: 'StarRocks',
  tableau: 'Tableau',
  teradata: 'Teradata',
  trino: 'Trino',
  tsql: 'SQL Server',
};

export const COMMON = ['hive', 'spark', 'clickhouse', 'mysql', 'postgres', 'trino'];

/** Extra words a search should match, e.g. "pg" or "mssql". */
const ALIASES: Record<string, string> = {
  '': 'generic ansi 通用 标准',
  postgres: 'pg postgresql',
  tsql: 'tsql t-sql mssql sqlserver azure',
  spark: 'sparksql',
  databricks: 'delta',
  bigquery: 'bq google',
  clickhouse: 'ch',
  fabric: 'microsoft',
};

export const label = (d: string) => LABELS[d] ?? d;

export const isDialect = (d: unknown, allowGeneric: boolean): d is string =>
  typeof d === 'string' && d in LABELS && (allowGeneric || d !== '');

/** The picker's groups: common first, then the rest by name. A query collapses
 * them into one list of matches, best (name starts with the query) first. */
export function groups(query: string, allowGeneric: boolean): { title: string; items: string[] }[] {
  const all = Object.keys(LABELS).filter((d) => allowGeneric || d !== '');
  const q = query.trim().toLowerCase();
  if (!q) {
    const common = [...(allowGeneric ? [''] : []), ...COMMON];
    const rest = all.filter((d) => !common.includes(d)).sort((a, b) => label(a).localeCompare(label(b)));
    return [
      { title: '常用', items: common },
      { title: '全部', items: rest },
    ];
  }
  const hay = (d: string) => `${label(d)} ${d} ${ALIASES[d] ?? ''}`.toLowerCase();
  const hits = all.filter((d) => hay(d).includes(q));
  const starts = (d: string) => label(d).toLowerCase().startsWith(q) || d.startsWith(q);
  hits.sort((a, b) => Number(starts(b)) - Number(starts(a)) || label(a).localeCompare(label(b)));
  return [{ title: '匹配', items: hits }];
}
