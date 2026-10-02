/** Renders the analysis tabs: syntax tree, column lineage and structural
 * changes. Everything is built as escaped HTML strings. */

import type { Analysis, ASTNode, DiffChange, LineageRow } from './api';
import { esc } from './ui';

export type Tab = 'ast' | 'lineage' | 'diff';

const state = (title: string, body = '') =>
  `<div class="q-state"><b>${esc(title)}</b>${body ? `<span>${esc(body)}</span>` : ''}</div>`;

const failed = (what: string, why: string) =>
  `<p class="q-notice q-notice--warn">${esc(what)}没能分析出来：${esc(why)}</p>`;

export function emptyAnalysis(): string {
  return state('还没有分析结果', '格式化或转换之后，这里会显示语法树、字段血缘和改动。');
}

export function renderTab(tab: Tab, a: Analysis, transpiled: boolean): string {
  if (tab === 'ast') return renderAST(a);
  if (tab === 'lineage') return renderLineage(a);
  return renderDiff(a, transpiled);
}

/** "2 张表 · 7 个字段" */
export function summary(a: Analysis): string {
  const parts = [];
  if (a.tables.length) parts.push(`${a.tables.length} 张表`);
  if (a.columns.length) parts.push(`${a.columns.length} 个字段`);
  return parts.join(' · ');
}

// ── Syntax tree ────────────────────────────────────────────────────────────

function renderAST(a: Analysis): string {
  if (a.errors.ast) return failed('语法树', a.errors.ast);
  if (!a.ast) return state('没有语法树');
  const tables = a.tables.length
    ? `<div class="tables"><span class="q-meta">表</span>${a.tables.map((t) => `<code class="q-chip">${esc(t)}</code>`).join('')}</div>`
    : '';
  return `${tables}
    <div class="ast-tools">
      <button class="q-btn q-btn--quiet q-btn--sm" type="button" data-ast="open">全部展开</button>
      <button class="q-btn q-btn--quiet q-btn--sm" type="button" data-ast="close">全部收起</button>
    </div>
    <div class="ast">${node(a.ast, 0)}</div>`;
}

function node(n: ASTNode, depth: number): string {
  const head =
    (n.key ? `<span class="ast-key">${esc(n.key)}</span>` : '') +
    `<span class="ast-type">${esc(n.type)}</span>` +
    `<code class="ast-sql">${esc(n.sql)}</code>`;
  const cut = n.truncated ? '<p class="ast-cut">节点太多，后面的没有展开</p>' : '';
  if (!n.children?.length) return `<div class="ast-leaf">${head}</div>${cut}`;
  const kids = n.children.map((c) => node(c, depth + 1)).join('');
  return `<details${depth < 2 ? ' open' : ''}><summary>${head}</summary><div class="ast-kids">${kids}${cut}</div></details>`;
}

// ── Lineage ────────────────────────────────────────────────────────────────

function renderLineage(a: Analysis): string {
  if (a.errors.lineage) return failed('字段血缘', a.errors.lineage);
  if (!a.lineage.length) return state('没有可追溯的输出字段', '建表语句、INSERT … VALUES 这类没有查询结果的语句不会出现在这里。');

  // Consecutive rows for one output column share its cell.
  const groups: { stmt: number | null; output: string; expression: string; rows: LineageRow[] }[] = [];
  for (const r of a.lineage) {
    const last = groups.at(-1);
    const stmt = r.statement ?? null;
    if (last && last.stmt === stmt && last.output === r.output) last.rows.push(r);
    else groups.push({ stmt, output: r.output, expression: r.expression, rows: [r] });
  }

  let body = '';
  let stmt: number | null = null;
  for (const g of groups) {
    if (g.stmt !== null && g.stmt !== stmt) {
      stmt = g.stmt;
      body += `<tr class="stmt"><th colspan="3">第 ${stmt} 条语句</th></tr>`;
    }
    g.rows.forEach((r, i) => {
      const first = i === 0;
      const span = g.rows.length > 1 ? ` rowspan="${g.rows.length}"` : '';
      body += '<tr>';
      if (first) body += `<td${span}><code class="col">${esc(g.output)}</code></td>`;
      body += `<td>${source(r)}</td>`;
      if (first) body += `<td${span}><code class="expr">${esc(g.expression)}</code></td>`;
      body += '</tr>';
    });
  }
  return `<div class="q-table-wrap flat"><table class="q-table lineage">
    <thead><tr><th>输出字段</th><th>来自</th><th>表达式</th></tr></thead>
    <tbody>${body}</tbody></table></div>`;
}

function source(r: LineageRow): string {
  if (!r.source_table) return '<span class="none">常量或算出来的值</span>';
  return `<span class="tbl">${esc(r.source_table)}</span>.<code class="col">${esc(r.source_column ?? '')}</code>`;
}

// ── Diff ───────────────────────────────────────────────────────────────────

const KINDS: Record<DiffChange['type'], string> = { remove: '删除', insert: '新增', move: '移动', update: '修改' };
const NOTE = '对比的是输入和转换结果的语法结构。同一个函数换了写法（比如 NVL 和 COALESCE）不算改动。';
const MAX_SHOWN = 200;

function renderDiff(a: Analysis, transpiled: boolean): string {
  if (a.errors.diff) return failed('改动', a.errors.diff);
  if (!transpiled || !a.diff) return state('转换之后才能看到改动', NOTE);
  const { changes, summary } = a.diff;
  if (!changes.length) return state('结构上没有变化', NOTE);

  const counts = (['removed', 'inserted', 'moved', 'updated'] as const)
    .map((k, i) => [Object.values(KINDS)[i], summary[k] ?? 0] as const)
    .filter(([, n]) => n > 0)
    .map(([name, n]) => `${name} ${n}`)
    .join(' · ');
  const rows = changes
    .slice(0, MAX_SHOWN)
    .map(
      (c) => `<li class="change change--${c.type}">
        <span class="badge">${KINDS[c.type] ?? esc(c.type)}</span>
        <code>${esc(c.sql)}</code>${c.type === 'update' && c.target ? `<span class="arrow">→</span><code>${esc(c.target)}</code>` : ''}
      </li>`,
    )
    .join('');
  const more = changes.length > MAX_SHOWN ? `<p class="q-meta">只列出前 ${MAX_SHOWN} 处。</p>` : '';
  return `<p class="diff-sum">${counts}</p><ul class="changes">${rows}</ul>${more}<p class="q-meta">${NOTE}</p>`;
}
