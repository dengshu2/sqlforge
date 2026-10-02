import './quiet.css';
import './app.css';

import { emptyAnalysis, renderTab, summary, type Tab } from './analysis';
import { type Analysis, ApiError, type TranspileResult, analyzeSQL, formatSQL, transpileSQL } from './api';
import { groups, label } from './dialects';
import { type Draft, MAX_SQL, loadDraft, packDraft, saveDraft, sharedIn, unpackDraft } from './draft';
import { createEditor } from './editor';
import { describeError } from './messages';
import { $, coarse, debounce, esc, isMac, toast } from './ui';

const SAMPLE = `-- 近 30 天各城市的下单人数和销售额
SELECT
  u.city,
  COUNT(DISTINCT o.user_id) AS buyers,
  SUM(NVL(o.amount, 0)) AS revenue,
  DATE_FORMAT(MAX(o.created_at), 'yyyy-MM-dd') AS last_order
FROM dw.orders o
JOIN dw.users u ON o.user_id = u.id
WHERE o.dt >= DATE_SUB(CURRENT_DATE, 30)
GROUP BY u.city
HAVING COUNT(*) > 10
ORDER BY revenue DESC
LIMIT 20;`;

const DEFAULT: Draft = { sql: SAMPLE, from: 'hive', to: 'postgres' };

// ── State ──────────────────────────────────────────────────────────────────

const draft: Draft = { ...DEFAULT };
/** What the result card shows, so it can say when the input has moved on. */
let shown: { sql: string; from: string; to: string } | null = null;
let analysis: Analysis | null = null;
let analysisHasDiff = false;
let tab: Tab = 'ast';
let picking: 'from' | 'to' | null = null;
let action: AbortController | null = null;
let analyzing: AbortController | null = null;

try {
  const t = localStorage.getItem('sqlforge:tab');
  if (t === 'ast' || t === 'lineage' || t === 'diff') tab = t;
} catch {
  // keep the default tab
}

// ── Elements ───────────────────────────────────────────────────────────────

const paneIn = $('#pane-in');
const paneOut = $('#pane-out');
const formatBtn = $<HTMLButtonElement>('#format');
const transpileBtn = $<HTMLButtonElement>('#transpile');
const pickFrom = $<HTMLButtonElement>('#pick-from');
const pickTo = $<HTMLButtonElement>('#pick-to');
const swapBtn = $<HTMLButtonElement>('#swap');
const picker = $('#picker');
const pickerSearch = $<HTMLInputElement>('#picker-search');
const pickerList = $('#picker-list');
const clearBtn = $<HTMLButtonElement>('#clear');
const copyBtn = $<HTMLButtonElement>('#copy');
const inError = $('#in-error');
const outNotes = $('#out-notes');
const anBody = $('#an-body');
const anContent = $('#an-content');

const runKeys = [
  { key: 'Mod-Enter', run: () => (run('transpile'), true) },
  { key: 'Shift-Mod-f', run: () => (run('format'), true) },
];

// ── Start: a shared link, else this device's draft, else the sample ───────

const packed = sharedIn(location.hash);
const fromLink = packed ? await unpackDraft(packed) : null;
if (packed) history.replaceState(null, '', location.pathname + location.search);
Object.assign(draft, fromLink ?? loadDraft() ?? DEFAULT);

const input = createEditor($('#editor-in'), {
  label: 'SQL 输入',
  placeholder: '粘贴或输入 SQL，可以有多条语句',
  dialect: draft.from,
  value: draft.sql,
  keys: runKeys,
  onChange(text) {
    draft.sql = text;
    clearInputError();
    updateInputMeta();
    updateStale();
    remember();
  },
});

const output = createEditor($('#editor-out'), {
  label: '转换结果',
  placeholder: '点「转换」，结果会出现在这里',
  dialect: draft.to,
  readonly: true,
  keys: runKeys,
});

const remember = debounce(() => saveDraft(draft), 400);

$('#keys').innerHTML = isMac
  ? '<kbd>⌘</kbd> <kbd>↩</kbd> 转换 · <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>F</kbd> 格式化'
  : '<kbd>Ctrl</kbd> + <kbd>Enter</kbd> 转换 · <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>F</kbd> 格式化';

updateDialects();
updateInputMeta();
renderAnalysis();
if (fromLink) {
  saveDraft(draft); // a reload should show what is on screen, not the older draft
  toast('已打开分享的 SQL');
  run('transpile');
}

// ── Actions ────────────────────────────────────────────────────────────────

async function run(kind: 'format' | 'transpile') {
  const sql = input.get();
  if (!sql.trim()) {
    input.focus();
    return;
  }
  if (sql.length > MAX_SQL) {
    toast('SQL 超过 100,000 字符，拆成几段再试', 'error');
    return;
  }
  closePicker();
  action?.abort();
  action = new AbortController();
  const signal = action.signal;
  const btn = kind === 'format' ? formatBtn : transpileBtn;
  const pane = kind === 'format' ? paneIn : paneOut;
  const from = draft.from;
  const to = draft.to;
  setBusy(btn, pane, true);
  clearInputError();
  try {
    if (kind === 'format') {
      const { formatted } = await formatSQL(sql, from, signal);
      if (formatted !== sql) input.set(formatted);
      toast(coarse() ? '已格式化' : `已格式化，${isMac ? '⌘' : 'Ctrl'} + Z 可以撤销`);
      analyze(formatted, from);
    } else {
      const out = await transpileSQL(sql, from, to, signal);
      output.set(out.result);
      output.setDialect(to);
      shown = { sql, from, to };
      copyBtn.hidden = false;
      renderNotes(out, to);
      updateStale();
      analyze(sql, from, { sql: out.result, dialect: to });
    }
  } catch (err) {
    if (signal.aborted) return;
    if (err instanceof ApiError && err.status === 422) showInputError(err);
    else toast(err instanceof Error ? err.message : '出了点问题，请重试', 'error');
  } finally {
    if (!signal.aborted) setBusy(btn, pane, false);
  }
}

function setBusy(btn: HTMLButtonElement, pane: HTMLElement, busy: boolean) {
  for (const b of [formatBtn, transpileBtn]) {
    b.classList.toggle('is-busy', busy && b === btn);
    b.disabled = busy;
  }
  for (const p of [paneIn, paneOut]) p.classList.toggle('is-busy', busy && p === pane);
}

function showInputError(err: ApiError) {
  const e = describeError(err);
  inError.innerHTML = esc(e.text) + (e.original ? `<small>${esc(e.original)}</small>` : '');
  inError.hidden = false;
  input.markError(e.line);
}

function clearInputError() {
  if (inError.hidden) return;
  inError.hidden = true;
  input.markError(null);
}

function renderNotes(out: TranspileResult, to: string) {
  let html = '';
  if (out.untranslated_functions.length) {
    html += `<div class="q-notice q-notice--warn">这些函数没能换成 ${esc(label(to))} 的写法，需要手动改：${out.untranslated_functions
      .map((f) => `<code>${esc(f)}</code>`)
      .join('、')}</div>`;
  }
  if (out.warnings.length) {
    html += `<div class="q-notice q-notice--warn">目标方言表达不了其中一些写法，结果可能要手动调整：<ul>${out.warnings
      .map((w) => `<li><code>${esc(w)}</code></li>`)
      .join('')}</ul></div>`;
  }
  if (out.rewritten_functions.length) {
    html += `<p class="q-meta">换了写法的函数：${out.rewritten_functions.map(esc).join('、')}</p>`;
  }
  outNotes.innerHTML = html;
  outNotes.hidden = !html;
}

function updateInputMeta() {
  const doc = input.view.state.doc;
  const empty = doc.length === 0;
  const count = $('#in-count');
  count.textContent = empty ? '' : `${doc.lines} 行 · ${doc.length.toLocaleString()} 字符`;
  count.classList.toggle('q-count--warn', doc.length > MAX_SQL);
  clearBtn.textContent = empty ? '示例' : '清空';
}

function updateStale() {
  const stale = !!shown && (shown.sql !== draft.sql || shown.from !== draft.from || shown.to !== draft.to);
  $('#out-stale').hidden = !stale;
}

clearBtn.addEventListener('click', () => {
  if (input.get()) {
    input.set('');
    output.set('');
    shown = null;
    copyBtn.hidden = true;
    outNotes.hidden = true;
    analysis = null;
    renderAnalysis();
    updateStale();
  } else {
    input.set(SAMPLE);
  }
  input.focus();
});

copyBtn.addEventListener('click', async () => {
  const text = output.get();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    toast('复制失败，请检查浏览器的剪贴板权限', 'error');
    return;
  }
  const use = copyBtn.querySelector('use')!;
  use.setAttribute('href', '#i-check');
  setTimeout(() => use.setAttribute('href', '#i-copy'), 1500);
  toast('已复制结果');
});

formatBtn.addEventListener('click', () => run('format'));
transpileBtn.addEventListener('click', () => run('transpile'));

document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.isComposing) return;
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (mod && e.key === 'Enter') {
    e.preventDefault();
    run('transpile');
  } else if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    run('format');
  }
});

// ── Dialects ───────────────────────────────────────────────────────────────

function updateDialects() {
  $('#from-label').textContent = label(draft.from);
  $('#to-label').textContent = label(draft.to);
  $('#in-dialect').textContent = label(draft.from);
  $('#out-dialect').textContent = label(draft.to);
  swapBtn.disabled = draft.from === '';
  input.setDialect(draft.from);
  pickFrom.setAttribute('aria-expanded', String(picking === 'from'));
  pickTo.setAttribute('aria-expanded', String(picking === 'to'));
}

function openPicker(which: 'from' | 'to') {
  if (picking === which) return closePicker();
  picking = which;
  $('#picker-title').textContent = which === 'from' ? '源方言' : '目标方言';
  pickerSearch.value = '';
  renderPicker();
  picker.hidden = false;
  updateDialects();
  if (!coarse()) pickerSearch.focus(); // a phone keyboard would cover the list
}

function closePicker(focusTrigger = false) {
  if (!picking) return;
  const trigger = picking === 'from' ? pickFrom : pickTo;
  picking = null;
  picker.hidden = true;
  updateDialects();
  if (focusTrigger) trigger.focus();
}

function renderPicker() {
  if (!picking) return;
  const current = draft[picking];
  const list = groups(pickerSearch.value, picking === 'from');
  const searching = !!pickerSearch.value.trim();
  if (!list[0].items.length) {
    pickerList.innerHTML = `<p class="q-empty">没有找到「${esc(pickerSearch.value.trim())}」</p>`;
    return;
  }
  pickerList.innerHTML = list
    .map(
      (g) => `<div class="dgroup"><h4>${g.title}</h4><div class="dgrid">${g.items
        .map(
          (d, i) =>
            `<button type="button" class="ditem${searching && i === 0 ? ' is-first' : ''}" data-dialect="${esc(d)}" aria-pressed="${d === current}">${esc(label(d))}</button>`,
        )
        .join('')}</div></div>`,
    )
    .join('');
}

function pick(dialect: string) {
  if (!picking) return;
  const changed = draft[picking] !== dialect;
  draft[picking] = dialect;
  closePicker(true);
  if (!changed) return;
  remember();
  updateStale();
  if (shown) run('transpile'); // the result is on screen: keep it current
}

pickFrom.addEventListener('click', () => openPicker('from'));
pickTo.addEventListener('click', () => openPicker('to'));
$('#picker-close').addEventListener('click', () => closePicker(true));
pickerSearch.addEventListener('input', renderPicker);
pickerSearch.addEventListener('keydown', (e) => {
  if (e.isComposing || e.keyCode === 229) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    const first = pickerList.querySelector<HTMLButtonElement>('.ditem');
    if (first) pick(first.dataset.dialect!);
  }
});
picker.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    closePicker(true);
  }
});
pickerList.addEventListener('click', (e) => {
  const item = (e.target as HTMLElement).closest<HTMLButtonElement>('.ditem');
  if (item) pick(item.dataset.dialect!);
});

swapBtn.addEventListener('click', () => {
  if (!draft.from) return;
  const result = output.get();
  const current = !!shown && $('#out-stale').hidden;
  [draft.from, draft.to] = [draft.to, draft.from];
  closePicker();
  updateDialects();
  remember();
  // With a current result on screen, swapping turns it around: the result
  // becomes the input and is converted back.
  if (current && result) {
    input.set(result);
    run('transpile');
  } else {
    updateStale();
  }
});

// ── Analysis ───────────────────────────────────────────────────────────────

async function analyze(sql: string, dialect: string, target?: { sql: string; dialect: string }) {
  analyzing?.abort();
  analyzing = new AbortController();
  const signal = analyzing.signal;
  anBody.classList.add('is-busy');
  try {
    analysis = await analyzeSQL(sql, dialect, target, signal);
    analysisHasDiff = !!target;
    renderAnalysis();
  } catch (err) {
    if (signal.aborted) return;
    anContent.innerHTML = `<p class="q-notice q-notice--warn">分析没能完成：${esc(err instanceof Error ? err.message : String(err))}</p>`;
  } finally {
    if (!signal.aborted) anBody.classList.remove('is-busy');
  }
}

function renderAnalysis() {
  document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => {
    const on = b.dataset.tab === tab;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
    if (on) anBody.setAttribute('aria-labelledby', b.id);
  });
  $('#an-meta').textContent = analysis ? summary(analysis) : '';
  anContent.innerHTML = analysis ? renderTab(tab, analysis, analysisHasDiff) : emptyAnalysis();
}

const tabs = [...document.querySelectorAll<HTMLButtonElement>('[data-tab]')];
for (const b of tabs) {
  b.addEventListener('click', () => {
    tab = b.dataset.tab as Tab;
    try {
      localStorage.setItem('sqlforge:tab', tab);
    } catch {
      // not remembered
    }
    renderAnalysis();
  });
  b.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const next = tabs[(tabs.indexOf(b) + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    next.click();
    next.focus();
  });
}

anContent.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-ast]');
  if (!btn) return;
  const open = btn.dataset.ast === 'open';
  anContent.querySelectorAll('details').forEach((d) => (d.open = open));
});

// ── Share ──────────────────────────────────────────────────────────────────

$('#share').addEventListener('click', async () => {
  if (!draft.sql.trim()) {
    toast('先写点 SQL 再分享');
    return;
  }
  const url = `${location.origin}${location.pathname}#s=${await packDraft(draft)}`;
  if (url.length > 60_000) {
    toast('这段 SQL 太长，放不进链接', 'error');
    return;
  }
  if (coarse() && navigator.share) {
    try {
      await navigator.share({ title: 'SQLForge', url });
      return;
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('链接已复制，打开就能看到这段 SQL 和方言');
  } catch {
    toast('复制失败，请检查浏览器的剪贴板权限', 'error');
  }
});
