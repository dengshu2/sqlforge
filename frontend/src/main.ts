/** SQLForge — main application entry point. */

import './style.css';
import { createEditor, type EditorInstance } from './editor';
import {
  formatSQL,
  transpileSQL,
  optimizeSQL,
  parseSQL,
  diffSQL,
  lineageSQL,
  fetchDialects,
  type ASTNode,
} from './api';

/* ─── DOM refs ───────────────────────────────────────────────────────────── */

const $  = <T extends HTMLElement>(s: string): T => document.querySelector(s) as T;

const sourceDialect = $<HTMLSelectElement>('#source-dialect');
const targetDialect = $<HTMLSelectElement>('#target-dialect');
const btnFormat     = $<HTMLButtonElement>('#btn-format');
const btnTranspile  = $<HTMLButtonElement>('#btn-transpile');
const btnOptimize   = $<HTMLButtonElement>('#btn-optimize');
const btnCopy       = $<HTMLButtonElement>('#btn-copy');
const btnToggle     = $<HTMLButtonElement>('#btn-toggle-analysis');
const analysisContent = $<HTMLDivElement>('.analysis-panel__content');
const toastContainer  = $<HTMLDivElement>('#toast-container');
const shortcutsDialog = $<HTMLDialogElement>('#shortcuts-dialog');
const btnShortcuts    = $<HTMLButtonElement>('#btn-keyboard-shortcuts');
const btnCloseShort   = $<HTMLButtonElement>('#btn-close-shortcuts');
const divider         = $<HTMLDivElement>('.divider');
const lineageColumn   = $<HTMLInputElement>('#lineage-column');
const btnTraceLineage = $<HTMLButtonElement>('#btn-trace-lineage');
const lineageResults  = $<HTMLDivElement>('#lineage-results');
const errorsContent   = $<HTMLDivElement>('#errors-content');
const tabErrors       = $<HTMLButtonElement>('#tab-errors');

/* ─── Editors ────────────────────────────────────────────────────────────── */

let inputEditor: EditorInstance;
let outputEditor: EditorInstance;

const SAMPLE_SQL = `-- Paste your SQL here or try this example
SELECT
  u.id,
  u.name,
  COUNT(o.id) AS order_count,
  SUM(o.amount) AS total_spent
FROM users u
LEFT JOIN orders o
  ON u.id = o.user_id
WHERE u.created_at > '2024-01-01'
  AND u.status = 'active'
GROUP BY u.id, u.name
HAVING COUNT(o.id) > 3
ORDER BY total_spent DESC
LIMIT 50;`;

function initEditors() {
  inputEditor = createEditor($('#editor-input'), {
    placeholder: 'Paste your SQL here...',
    initialValue: SAMPLE_SQL,
    initialDialect: sourceDialect.value,
  });

  outputEditor = createEditor($('#editor-output'), {
    readonly: true,
    placeholder: 'Output will appear here',
    initialDialect: targetDialect.value,
  });
}

/* ─── Dialect Select ─────────────────────────────────────────────────────── */

const DIALECT_LABELS: Record<string, string> = {
  bigquery: 'BigQuery',
  clickhouse: 'ClickHouse',
  databricks: 'Databricks',
  doris: 'Doris',
  drill: 'Drill',
  duckdb: 'DuckDB',
  hive: 'Hive',
  materialize: 'Materialize',
  mysql: 'MySQL',
  oracle: 'Oracle',
  postgres: 'PostgreSQL',
  presto: 'Presto',
  redshift: 'Redshift',
  snowflake: 'Snowflake',
  spark: 'Spark',
  sqlite: 'SQLite',
  starrocks: 'StarRocks',
  tableau: 'Tableau',
  teradata: 'Teradata',
  trino: 'Trino',
  tsql: 'T-SQL',
};

async function populateDialects() {
  let dialects: string[];
  try {
    dialects = await fetchDialects();
  } catch {
    dialects = Object.keys(DIALECT_LABELS);
  }

  const buildOptions = (select: HTMLSelectElement, addAutoDetect: boolean) => {
    const currentValue = select.value;
    select.innerHTML = '';

    if (addAutoDetect) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Auto Detect';
      select.appendChild(opt);
    }

    for (const d of dialects) {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = DIALECT_LABELS[d] ?? d;
      select.appendChild(opt);
    }

    if (currentValue && dialects.includes(currentValue)) {
      select.value = currentValue;
    }
  };

  buildOptions(sourceDialect, true);
  buildOptions(targetDialect, false);
  targetDialect.value = 'postgres';
}

/* ─── Error collection ────────────────────────────────────────────────────── */

const collectedErrors: { time: Date; source: string; message: string }[] = [];

function reportError(source: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  collectedErrors.push({ time: new Date(), source, message });
  updateErrorsPanel();
}

function clearErrors() {
  collectedErrors.length = 0;
  updateErrorsPanel();
}

function updateErrorsPanel() {
  if (collectedErrors.length === 0) {
    errorsContent.innerHTML = `
      <div class="analysis-view__empty analysis-view__empty--ok">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        <p>No errors</p>
      </div>`;
    tabErrors.textContent = 'Errors';
    return;
  }

  tabErrors.textContent = `Errors (${collectedErrors.length})`;
  let html = '<ul class="errors-list">';
  for (const e of collectedErrors) {
    const time = e.time.toLocaleTimeString();
    html += `<li class="errors-list__item">`;
    html += `<span class="errors-list__time">${esc(time)}</span>`;
    html += `<span class="errors-list__source">${esc(e.source)}</span>`;
    html += `<span class="errors-list__msg">${esc(e.message)}</span>`;
    html += `</li>`;
  }
  html += '</ul>';
  errorsContent.innerHTML = html;
}

/* ─── Actions ────────────────────────────────────────────────────────────── */

async function withLoading(btn: HTMLButtonElement, fn: () => Promise<void>) {
  btn.classList.add('loading');
  try {
    await fn();
  } catch (err) {
    reportError(btn.textContent?.trim() ?? 'action', err);
    showToast(err instanceof Error ? err.message : 'An error occurred', 'error');
  } finally {
    btn.classList.remove('loading');
  }
}

async function doFormat() {
  await withLoading(btnFormat, async () => {
    const sql = inputEditor.getValue().trim();
    if (!sql) return;

    clearErrors();
    const result = await formatSQL(sql, sourceDialect.value);
    inputEditor.setValue(result.formatted);
    showToast('Formatted', 'success');

    await loadAST(result.formatted, sourceDialect.value);
  });
}

async function doTranspile() {
  await withLoading(btnTranspile, async () => {
    const sql = inputEditor.getValue().trim();
    if (!sql) return;

    clearErrors();
    showOutputSkeleton();
    const result = await transpileSQL(
      sql,
      sourceDialect.value,
      targetDialect.value,
    );
    outputEditor.setValue(result.result);

    if (result.warnings.length > 0) {
      for (const w of result.warnings) {
        reportError('Transpile', new Error(w));
      }
      showToast(`Transpiled with ${result.warnings.length} warning(s)`, 'error');
    } else {
      showToast(`Transpiled to ${DIALECT_LABELS[targetDialect.value] ?? targetDialect.value}`, 'success');
    }

    await loadAST(sql, sourceDialect.value);
    await loadDiff(sql, result.result, sourceDialect.value);
  });
}

async function doOptimize() {
  await withLoading(btnOptimize, async () => {
    const sql = inputEditor.getValue().trim();
    if (!sql) return;

    clearErrors();
    showOutputSkeleton();
    const result = await optimizeSQL(sql, sourceDialect.value);
    outputEditor.setValue(result.optimized);

    const ruleText = result.rules_applied.length > 0
      ? result.rules_applied.join(', ')
      : 'no changes';
    showToast(`Optimized: ${ruleText}`, 'success');

    await loadAST(sql, sourceDialect.value);
  });
}

/* ─── Skeleton loader ────────────────────────────────────────────────────── */

function showOutputSkeleton() {
  outputEditor.setValue('');
  const container = document.getElementById('editor-output')!;
  const skeleton = document.createElement('div');
  skeleton.className = 'skeleton-overlay';
  skeleton.innerHTML = Array.from({ length: 5 }, () =>
    '<div class="skeleton skeleton-line"></div>'
  ).join('');
  skeleton.style.cssText = 'position:absolute;inset:0;z-index:2;padding-top:12px;background:var(--bg-primary)';
  container.style.position = 'relative';
  container.appendChild(skeleton);

  setTimeout(() => skeleton.remove(), 3000);

  const observer = new MutationObserver(() => {
    if (outputEditor.getValue().length > 0) {
      skeleton.remove();
      observer.disconnect();
    }
  });
  observer.observe(container, { childList: true, subtree: true, characterData: true });
}

/* ─── Copy ───────────────────────────────────────────────────────────────── */

async function doCopy() {
  const text = outputEditor.getValue().trim();
  if (!text) {
    showToast('Nothing to copy', 'error');
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    btnCopy.classList.add('copied');
    const label = btnCopy.querySelector('.btn-label')!;
    label.textContent = 'Copied';
    showToast('Copied to clipboard', 'success');
    setTimeout(() => {
      btnCopy.classList.remove('copied');
      label.textContent = 'Copy';
    }, 2000);
  } catch {
    showToast('Failed to copy', 'error');
  }
}

/* ─── Analysis Panel ─────────────────────────────────────────────────────── */

function toggleAnalysis() {
  const expanded = btnToggle.getAttribute('aria-expanded') === 'true';
  btnToggle.setAttribute('aria-expanded', String(!expanded));
  analysisContent.hidden = expanded;
}

function initTabs() {
  const tabs = document.querySelectorAll<HTMLButtonElement>('.analysis-tab');
  const panels = document.querySelectorAll<HTMLDivElement>('.analysis-view');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.setAttribute('aria-selected', 'false'));
      panels.forEach((p) => (p.hidden = true));

      tab.setAttribute('aria-selected', 'true');
      const panelId = tab.getAttribute('aria-controls')!;
      document.getElementById(panelId)!.hidden = false;
    });
  });
}

async function loadAST(sql: string, dialect: string) {
  try {
    const result = await parseSQL(sql, dialect);
    const panel = document.getElementById('panel-ast')!;
    panel.innerHTML = renderASTTree(result.ast);
  } catch (err) {
    reportError('AST', err);
  }
}

async function loadDiff(sourceSql: string, targetSql: string, dialect: string) {
  try {
    const result = await diffSQL(sourceSql, targetSql, dialect);
    const panel = document.getElementById('panel-diff')!;
    panel.innerHTML = renderDiff(result.changes, result.summary);
  } catch (err) {
    reportError('Diff', err);
  }
}

async function doTraceLineage() {
  const sql = inputEditor.getValue().trim();
  const column = lineageColumn.value.trim();
  if (!sql) {
    showToast('Enter SQL first', 'error');
    return;
  }
  if (!column) {
    showToast('Enter a column name to trace', 'error');
    return;
  }

  btnTraceLineage.classList.add('loading');
  try {
    const result = await lineageSQL(sql, column, sourceDialect.value);
    lineageResults.innerHTML = renderLineage(result.lineage);
    showToast(`Traced lineage for '${column}'`, 'success');
  } catch (err) {
    reportError('Lineage', err);
    showToast(err instanceof Error ? err.message : 'Lineage analysis failed', 'error');
    lineageResults.innerHTML = `<div class="analysis-view__empty"><p>Lineage analysis failed. Check the Errors tab for details.</p></div>`;
  } finally {
    btnTraceLineage.classList.remove('loading');
  }
}

function renderLineage(lineage: { expression: string; source?: string }[]): string {
  if (lineage.length === 0) {
    return '<div class="analysis-view__empty"><p>No lineage data found</p></div>';
  }

  let html = '<ul class="lineage-list">';
  for (const node of lineage) {
    html += '<li class="lineage-list__item">';
    html += `<code class="lineage-list__expr">${esc(node.expression)}</code>`;
    if (node.source) {
      html += `<span class="lineage-list__arrow">←</span>`;
      html += `<span class="lineage-list__source">${esc(node.source)}</span>`;
    }
    html += '</li>';
  }
  html += '</ul>';
  return html;
}

function renderASTTree(node: ASTNode): string {
  const hasChildren = node.children && node.children.length > 0;
  const keyLabel = node.key ? `<span class="ast-node__key">${esc(node.key)}:</span> ` : '';
  const sqlPreview = node.sql.length > 60 ? node.sql.slice(0, 60) + '…' : node.sql;

  let html = '<ul class="ast-tree">';
  html += `<li class="ast-node">`;
  html += `${keyLabel}<span class="ast-node__type">${esc(node.type)}</span>`;
  html += `<span class="ast-node__sql">${esc(sqlPreview)}</span>`;

  if (hasChildren) {
    for (const child of node.children!) {
      html += renderASTTree(child);
    }
  }

  html += `</li></ul>`;
  return html;
}

function renderDiff(changes: { type: string; sql: string }[], summary: Record<string, number>): string {
  if (changes.length === 0) {
    return '<div class="analysis-view__empty"><p>No differences found</p></div>';
  }

  let html = `<div style="margin-bottom:8px;font-family:var(--font-ui);font-size:0.75rem;color:var(--text-muted)">`;
  html += Object.entries(summary).map(([k, v]) => `${k}: ${v}`).join(' · ');
  html += `</div>`;

  html += '<ul class="diff-list">';
  for (const change of changes.slice(0, 50)) {
    html += `<li class="diff-item diff-item--${esc(change.type)}">`;
    html += `<span class="diff-item__badge">${esc(change.type)}</span>`;
    html += `<code>${esc(change.sql)}</code>`;
    html += `</li>`;
  }
  html += '</ul>';
  return html;
}

function esc(s: string): string {
  const el = document.createElement('span');
  el.textContent = s;
  return el.innerHTML;
}

/* ─── Toast ──────────────────────────────────────────────────────────────── */

function showToast(message: string, type: 'success' | 'error' = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast--out');
    toast.addEventListener('animationend', () => toast.remove());
  }, 2500);
}

/* ─── Divider drag ───────────────────────────────────────────────────────── */

function initDivider() {
  const workspace = document.querySelector('.workspace')!;
  const inputPanel = document.querySelector('.panel--input') as HTMLElement;
  const outputPanel = document.querySelector('.panel--output') as HTMLElement;

  let isDragging = false;

  function isVerticalLayout(): boolean {
    return getComputedStyle(workspace).flexDirection === 'column';
  }

  divider.addEventListener('mousedown', (e) => {
    e.preventDefault();
    isDragging = true;
    divider.classList.add('dragging');
    document.body.style.cursor = isVerticalLayout() ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;

    const rect = workspace.getBoundingClientRect();
    const vertical = isVerticalLayout();
    const offset = vertical ? e.clientY - rect.top : e.clientX - rect.left;
    const total = vertical ? rect.height : rect.width;
    const pct = Math.max(20, Math.min(80, (offset / total) * 100));

    inputPanel.style.flex = `0 0 ${pct}%`;
    outputPanel.style.flex = `0 0 ${100 - pct}%`;
  });

  document.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    divider.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
}

/* ─── Shortcuts dialog ───────────────────────────────────────────────────── */

function initShortcuts() {
  btnShortcuts.addEventListener('click', () => shortcutsDialog.showModal());
  btnCloseShort.addEventListener('click', () => shortcutsDialog.close());
  shortcutsDialog.addEventListener('click', (e) => {
    if (e.target === shortcutsDialog) shortcutsDialog.close();
  });
}

/* ─── Keyboard shortcuts ─────────────────────────────────────────────────── */

function initGlobalKeys() {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'Enter') {
        e.preventDefault();
        doTranspile();
      } else if (e.shiftKey && e.key === 'F') {
        e.preventDefault();
        doFormat();
      } else if (e.shiftKey && e.key === 'O') {
        e.preventDefault();
        doOptimize();
      } else if (e.shiftKey && e.key === 'C') {
        e.preventDefault();
        doCopy();
      }
    }
  });
}

/* ─── Dialect change handlers ────────────────────────────────────────────── */

function initDialectChanges() {
  sourceDialect.addEventListener('change', () => {
    inputEditor.setDialect(sourceDialect.value);
  });

  targetDialect.addEventListener('change', () => {
    outputEditor.setDialect(targetDialect.value);
  });
}

/* ─── Init ───────────────────────────────────────────────────────────────── */

async function init() {
  initEditors();
  initTabs();
  initDivider();
  initShortcuts();
  initGlobalKeys();
  initDialectChanges();

  btnFormat.addEventListener('click', doFormat);
  btnTranspile.addEventListener('click', doTranspile);
  btnOptimize.addEventListener('click', doOptimize);
  btnCopy.addEventListener('click', doCopy);
  btnToggle.addEventListener('click', toggleAnalysis);
  btnTraceLineage.addEventListener('click', doTraceLineage);
  lineageColumn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doTraceLineage();
  });

  await populateDialects();
}

init();
