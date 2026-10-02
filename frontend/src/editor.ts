/** CodeMirror set up for the page: colours come from CSS variables, so the
 * editors follow the light and dark tokens without a second theme. */

import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { MSSQL, MySQL, PLSQL, PostgreSQL, SQLite, StandardSQL, sql, type SQLDialect } from '@codemirror/lang-sql';
import { HighlightStyle, bracketMatching, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState, Prec, StateEffect, StateField } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  type KeyBinding,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder,
} from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

const theme = EditorView.theme({
  '&': { height: '100%', background: 'transparent', color: 'var(--q-ink)', fontSize: '13.5px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--sf-code)', lineHeight: '1.65', overflow: 'auto', fontVariantLigatures: 'none' },
  '.cm-content': { caretColor: 'var(--q-ink)', padding: '2px 0 12px' },
  '.cm-cursor, .cm-dropCursor': { borderLeft: '2px solid var(--q-ink)' },
  '.cm-gutters': { background: 'transparent', border: 'none', color: 'var(--q-faint)' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 12px 0 6px', minWidth: '30px' },
  '.cm-activeLine': { background: 'var(--sf-active)' },
  '.cm-activeLineGutter': { background: 'transparent', color: 'var(--q-sub)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': {
    background: 'var(--sf-selection)',
  },
  '.cm-placeholder': { color: 'var(--q-faint)', fontFamily: 'var(--q-font)' },
  '.cm-matchingBracket': { background: 'var(--sf-bracket)', outline: 'none' },
  '.cm-nonmatchingBracket': { background: 'var(--q-danger-soft)' },
  '.cm-errorLine': { background: 'var(--q-danger-soft)' },
});

const colours = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.modifier], color: 'var(--sf-keyword)', fontWeight: '600' },
  { tag: [t.typeName, t.standard(t.name)], color: 'var(--sf-type)' },
  { tag: [t.function(t.variableName), t.function(t.name)], color: 'var(--sf-function)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--sf-string)' },
  { tag: [t.number, t.bool, t.null], color: 'var(--sf-number)' },
  { tag: t.comment, color: 'var(--sf-comment)', fontStyle: 'italic' },
  { tag: [t.operator, t.punctuation, t.paren, t.squareBracket, t.brace], color: 'var(--q-sub)' },
  { tag: t.special(t.name), color: 'var(--sf-type)' },
]);

/** Highlighting only: the closest grammar CodeMirror has for each dialect. */
function grammar(dialect: string): SQLDialect {
  switch (dialect) {
    case 'postgres':
    case 'redshift':
    case 'materialize':
    case 'risingwave':
    case 'duckdb':
      return PostgreSQL;
    case 'tsql':
    case 'fabric':
      return MSSQL;
    case 'oracle':
      return PLSQL;
    case 'sqlite':
      return SQLite;
    case 'mysql':
    case 'doris':
    case 'starrocks':
    case 'hive':
    case 'spark':
    case 'databricks':
    case 'bigquery':
    case 'clickhouse':
    case 'athena':
      return MySQL; // backtick identifiers
    default:
      return StandardSQL;
  }
}

const setErrorLine = StateEffect.define<number | null>();

const errorLine = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, tr) {
    for (const e of tr.effects) {
      if (!e.is(setErrorLine)) continue;
      if (e.value == null) return Decoration.none;
      const line = tr.state.doc.line(Math.min(Math.max(1, e.value), tr.state.doc.lines));
      return Decoration.set([Decoration.line({ class: 'cm-errorLine' }).range(line.from)]);
    }
    return tr.docChanged ? Decoration.none : marks;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export interface Editor {
  view: EditorView;
  get(): string;
  /** Replaces the text. Undoable unless it is the read-only output. */
  set(text: string): void;
  setDialect(dialect: string): void;
  markError(line: number | null): void;
  focus(): void;
}

export function createEditor(
  parent: HTMLElement,
  opts: {
    label: string;
    placeholder: string;
    dialect: string;
    value?: string;
    readonly?: boolean;
    keys?: KeyBinding[];
    onChange?: (text: string) => void;
  },
): Editor {
  const language = new Compartment();
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: opts.value ?? '',
      extensions: [
        theme,
        syntaxHighlighting(colours),
        lineNumbers(),
        highlightSpecialChars(),
        drawSelection(),
        bracketMatching(),
        EditorView.lineWrapping,
        language.of(sql({ dialect: grammar(opts.dialect) })),
        placeholder(opts.placeholder),
        EditorView.contentAttributes.of({
          'aria-label': opts.label,
          autocapitalize: 'off',
          autocorrect: 'off',
          spellcheck: 'false',
        }),
        opts.readonly
          ? EditorState.readOnly.of(true)
          : [history(), highlightActiveLine(), highlightActiveLineGutter(), errorLine],
        Prec.highest(keymap.of(opts.keys ?? [])),
        keymap.of([...defaultKeymap, ...(opts.readonly ? [] : [...historyKeymap, indentWithTab])]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) opts.onChange?.(u.state.doc.toString());
        }),
      ],
    }),
  });

  return {
    view,
    get: () => view.state.doc.toString(),
    set(text) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: 0 },
        scrollIntoView: true,
      });
    },
    setDialect(dialect) {
      view.dispatch({ effects: language.reconfigure(sql({ dialect: grammar(dialect) })) });
    },
    markError(line) {
      if (opts.readonly) return;
      const effects: StateEffect<unknown>[] = [setErrorLine.of(line)];
      if (line != null) {
        const pos = view.state.doc.line(Math.min(Math.max(1, line), view.state.doc.lines)).from;
        effects.push(EditorView.scrollIntoView(pos, { y: 'center' }));
      }
      view.dispatch({ effects });
    },
    focus: () => view.focus(),
  };
}
