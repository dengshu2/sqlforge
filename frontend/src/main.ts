/** SQLForge — main application entry point. */

import './style.css';
import { createEditor, type EditorInstance } from './editor';
import {
  formatSQL,
  transpileSQL,
  parseSQL,
  diffSQL,
  lineageSQL,
  fetchDialects,
  type ASTNode,
  type LineageMapping,
} from './api';

/* ─── Custom Select Component ────────────────────────────────────────────── */

interface SelectOption { value: string; label: string }

class CustomSelect {
  readonly el: HTMLDivElement;
  private _value = '';
  private _options: SelectOption[] = [];
  private _filtered: SelectOption[] = [];
  private _open = false;
  private _hlIdx = -1;
  private _handlers: (() => void)[] = [];
  private trigger: HTMLButtonElement;
  private labelEl: HTMLSpanElement;
  private dropdown: HTMLDivElement;
  private searchInput: HTMLInputElement;
  private listEl: HTMLDivElement;

  constructor(anchor: HTMLSelectElement) {
    this._value = anchor.value;
    const initLabel = anchor.options[anchor.selectedIndex]?.textContent ?? anchor.value;

    this.el = document.createElement('div');
    this.el.className = 'custom-select';

    this.trigger = document.createElement('button');
    this.trigger.type = 'button';
    this.trigger.className = 'custom-select__trigger';
    this.trigger.setAttribute('aria-haspopup', 'listbox');
    this.trigger.setAttribute('aria-expanded', 'false');

    this.labelEl = document.createElement('span');
    this.labelEl.className = 'custom-select__label';
    this.labelEl.textContent = initLabel;

    const arrow = document.createElement('span');
    arrow.className = 'custom-select__arrow';
    arrow.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>';
    this.trigger.append(this.labelEl, arrow);

    this.dropdown = document.createElement('div');
    this.dropdown.className = 'custom-select__dropdown';
    this.dropdown.setAttribute('role', 'listbox');

    const wrap = document.createElement('div');
    wrap.className = 'custom-select__search-wrap';
    const ico = document.createElement('span');
    ico.className = 'custom-select__search-icon';
    ico.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>';
    this.searchInput = document.createElement('input');
    this.searchInput.type = 'text';
    this.searchInput.className = 'custom-select__search';
    this.searchInput.placeholder = 'Search\u2026';
    this.searchInput.autocomplete = 'off';
    this.searchInput.spellcheck = false;
    wrap.append(ico, this.searchInput);

    this.listEl = document.createElement('div');
    this.listEl.className = 'custom-select__list';
    this.dropdown.append(wrap, this.listEl);
    this.el.append(this.trigger, this.dropdown);

    anchor.parentNode!.insertBefore(this.el, anchor);
    anchor.style.display = 'none';

    this.trigger.addEventListener('click', (e) => { e.stopPropagation(); this.toggle(); });
    this.searchInput.addEventListener('input', () => this.filter());
    this.searchInput.addEventListener('keydown', (e) => this.onKey(e));
    document.addEventListener('mousedown', (e) => {
      if (this._open && !this.el.contains(e.target as Node)) this.close();
    });
    this.el.addEventListener('focusout', () => {
      requestAnimationFrame(() => {
        if (this._open && !this.el.contains(document.activeElement)) this.close();
      });
    });
    window.addEventListener('resize', () => { if (this._open) this.close(); });
  }

  get value() { return this._value; }
  set value(v: string) {
    this._value = v;
    const o = this._options.find(o => o.value === v);
    this.labelEl.textContent = o?.label ?? (v || 'Select\u2026');
  }

  addEventListener(_t: string, fn: () => void) { if (_t === 'change') this._handlers.push(fn); }

  setOptions(opts: SelectOption[]) {
    this._options = opts;
    this._filtered = opts;
    this.renderList();
    const cur = this._options.find(o => o.value === this._value);
    if (cur) this.labelEl.textContent = cur.label;
  }

  private toggle() { this._open ? this.close() : this.open(); }

  private open() {
    this._open = true;
    this.el.classList.add('custom-select--open');
    this.trigger.setAttribute('aria-expanded', 'true');
    this.searchInput.value = '';
    this._filtered = this._options;
    this.renderList();
    this.positionDropdown();
    this._hlIdx = this._filtered.findIndex(o => o.value === this._value);
    this.applyHighlight();
    requestAnimationFrame(() => this.searchInput.focus());
  }

  private close() {
    if (!this._open) return;
    this._open = false;
    this.el.classList.remove('custom-select--open');
    this.trigger.setAttribute('aria-expanded', 'false');
    this._hlIdx = -1;
  }

  private pick(value: string) {
    const prev = this._value;
    this._value = value;
    const o = this._options.find(o => o.value === value);
    this.labelEl.textContent = o?.label ?? value;
    this.close();
    if (prev !== value) for (const fn of this._handlers) fn();
  }

  private filter() {
    const q = this.searchInput.value.toLowerCase().trim();
    this._filtered = q
      ? this._options.filter(o => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q))
      : this._options;
    this._hlIdx = this._filtered.length > 0 ? 0 : -1;
    this.renderList();
    this.applyHighlight();
  }

  private onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (this._hlIdx < this._filtered.length - 1) { this._hlIdx++; this.applyHighlight(); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (this._hlIdx > 0) { this._hlIdx--; this.applyHighlight(); } }
    else if (e.key === 'Enter') { e.preventDefault(); if (this._hlIdx >= 0) this.pick(this._filtered[this._hlIdx].value); }
    else if (e.key === 'Escape') { e.preventDefault(); this.close(); this.trigger.focus(); }
  }

  private renderList() {
    this.listEl.innerHTML = '';
    if (this._filtered.length === 0) {
      this.listEl.innerHTML = '<div class="custom-select__empty">No matches</div>';
      return;
    }
    for (let i = 0; i < this._filtered.length; i++) {
      const opt = this._filtered[i];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'custom-select__option';
      if (opt.value === this._value) btn.classList.add('custom-select__option--selected');
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', String(opt.value === this._value));
      btn.textContent = opt.label;
      btn.addEventListener('click', (e) => { e.stopPropagation(); this.pick(opt.value); });
      btn.addEventListener('mouseenter', () => { this._hlIdx = i; this.applyHighlight(); });
      this.listEl.appendChild(btn);
    }
  }

  private applyHighlight() {
    const items = this.listEl.querySelectorAll<HTMLButtonElement>('.custom-select__option');
    items.forEach((el, idx) => el.classList.toggle('custom-select__option--highlighted', idx === this._hlIdx));
    if (this._hlIdx >= 0 && items[this._hlIdx]) items[this._hlIdx].scrollIntoView({ block: 'nearest' });
  }

  private positionDropdown() {
    const rect = this.trigger.getBoundingClientRect();
    const maxH = 320, gap = 4;
    const below = window.innerHeight - rect.bottom - gap;
    const above = rect.top - gap;
    this.dropdown.style.top = '';
    this.dropdown.style.bottom = '';
    if (below >= maxH || below >= above) {
      this.dropdown.style.top = `${rect.bottom + gap}px`;
      this.dropdown.classList.remove('custom-select__dropdown--above');
    } else {
      this.dropdown.style.bottom = `${window.innerHeight - rect.top + gap}px`;
      this.dropdown.classList.add('custom-select__dropdown--above');
    }
    this.dropdown.style.left = `${rect.left}px`;
    this.dropdown.style.minWidth = `${Math.max(rect.width, 180)}px`;
  }
}

/* ─── DOM refs ───────────────────────────────────────────────────────────── */

const $  = <T extends HTMLElement>(s: string): T => document.querySelector(s) as T;

let sourceDialect: CustomSelect;
let targetDialect: CustomSelect;
const btnFormat     = $<HTMLButtonElement>('#btn-format');
const btnTranspile  = $<HTMLButtonElement>('#btn-transpile');

const btnCopy       = $<HTMLButtonElement>('#btn-copy');
const toastContainer  = $<HTMLDivElement>('#toast-container');
const shortcutsDialog = $<HTMLDialogElement>('#shortcuts-dialog');
const btnShortcuts    = $<HTMLButtonElement>('#btn-keyboard-shortcuts');
const btnCloseShort   = $<HTMLButtonElement>('#btn-close-shortcuts');
const divider         = $<HTMLDivElement>('.divider');
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

  const mapped: SelectOption[] = dialects.map(d => ({ value: d, label: DIALECT_LABELS[d] ?? d }));

  sourceDialect.setOptions([{ value: '', label: 'Auto Detect' }, ...mapped]);
  targetDialect.setOptions(mapped);
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

    await Promise.all([
      loadAST(result.formatted, sourceDialect.value),
      loadLineage(result.formatted, sourceDialect.value),
    ]);
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

    await Promise.all([
      loadAST(sql, sourceDialect.value),
      loadDiff(sql, result.result, sourceDialect.value),
      loadLineage(sql, sourceDialect.value),
    ]);
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

function initAnalysisResize() {
  const panel = document.querySelector<HTMLElement>('.analysis-panel')!;
  const resizeBar = document.getElementById('analysis-resize')!;
  let isDragging = false;
  let startY = 0;
  let startHeight = 0;

  resizeBar.addEventListener('mousedown', (e) => {
    e.preventDefault();
    isDragging = true;
    startY = e.clientY;
    startHeight = panel.offsetHeight;
    resizeBar.classList.add('dragging');
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const delta = startY - e.clientY;
    const newHeight = Math.max(80, Math.min(window.innerHeight * 0.5, startHeight + delta));
    panel.style.height = `${newHeight}px`;
  });

  document.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    resizeBar.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
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

async function loadLineage(sql: string, dialect: string) {
  try {
    const result = await lineageSQL(sql, dialect);
    lineageResults.innerHTML = renderLineage(result.mappings);
  } catch (err) {
    reportError('Lineage', err);
    lineageResults.innerHTML = `<div class="analysis-view__empty"><p>Lineage analysis failed. Check the Errors tab for details.</p></div>`;
  }
}

function renderLineage(mappings: LineageMapping[]): string {
  if (mappings.length === 0) {
    return '<div class="analysis-view__empty"><p>No output columns detected</p></div>';
  }

  let html = '<table class="lineage-table">';
  html += '<thead><tr>';
  html += '<th>Output</th>';
  html += '<th>Expression</th>';
  html += '<th>Source</th>';
  html += '</tr></thead>';
  html += '<tbody>';

  for (const m of mappings) {
    const source = formatSource(m.source_table, m.source_column);
    html += '<tr>';
    html += `<td><code class="lineage-table__col">${esc(m.output)}</code></td>`;
    html += `<td><code class="lineage-table__expr">${esc(m.expression)}</code></td>`;
    html += `<td>${source}</td>`;
    html += '</tr>';
  }

  html += '</tbody></table>';
  return html;
}

function formatSource(table: string | null, column: string | null): string {
  if (!table && !column) {
    return '<span class="lineage-table__unknown">—</span>';
  }
  const parts: string[] = [];
  if (table) parts.push(`<span class="lineage-table__table">${esc(table)}</span>`);
  if (column) parts.push(`<code class="lineage-table__src-col">${esc(column)}</code>`);
  return parts.join('<span class="lineage-table__dot">.</span>');
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
  sourceDialect = new CustomSelect($<HTMLSelectElement>('#source-dialect'));
  targetDialect = new CustomSelect($<HTMLSelectElement>('#target-dialect'));

  initEditors();
  initTabs();
  initDivider();
  initAnalysisResize();
  initShortcuts();
  initGlobalKeys();
  initDialectChanges();

  btnFormat.addEventListener('click', doFormat);
  btnTranspile.addEventListener('click', doTranspile);
  btnCopy.addEventListener('click', doCopy);

  await populateDialects();
}

init();
