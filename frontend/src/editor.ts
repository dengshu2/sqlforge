/** CodeMirror 6 editor setup and custom theme. */

import { EditorView, keymap, placeholder as cmPlaceholder, lineNumbers } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { sql, StandardSQL, MySQL, PostgreSQL, SQLite } from '@codemirror/lang-sql';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

/* ── Custom sqlforge theme ─────────────────────────────────────────────── */

const forgeTheme = EditorView.theme({
  '&': {
    background: '#0f1117',
    color: '#e4e4e7',
  },
  '.cm-content': {
    caretColor: '#d4a843',
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    fontSize: '0.875rem',
    lineHeight: '1.6',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: '#d4a843',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    background: 'rgba(212, 168, 67, 0.15)',
  },
  '.cm-activeLine': {
    background: 'rgba(212, 168, 67, 0.04)',
  },
  '.cm-gutters': {
    background: '#161923',
    borderRight: '1px solid #1e2130',
    color: '#5c5e6a',
  },
  '.cm-activeLineGutter': {
    background: 'rgba(212, 168, 67, 0.08)',
  },
  '.cm-foldPlaceholder': {
    background: '#1c1f2e',
    border: '1px solid #2a2d3a',
    color: '#8b8d98',
  },
}, { dark: true });

const forgeHighlight = HighlightStyle.define([
  { tag: t.keyword, color: '#d4a843' },
  { tag: t.operatorKeyword, color: '#d4a843' },
  { tag: t.typeName, color: '#78b6e8' },
  { tag: t.string, color: '#98c379' },
  { tag: t.number, color: '#e5c07b' },
  { tag: t.bool, color: '#e5c07b' },
  { tag: t.null, color: '#e5c07b', fontStyle: 'italic' },
  { tag: t.operator, color: '#8b8d98' },
  { tag: t.punctuation, color: '#8b8d98' },
  { tag: t.paren, color: '#8b8d98' },
  { tag: t.squareBracket, color: '#8b8d98' },
  { tag: t.brace, color: '#8b8d98' },
  { tag: t.comment, color: '#5c5e6a', fontStyle: 'italic' },
  { tag: t.lineComment, color: '#5c5e6a', fontStyle: 'italic' },
  { tag: t.blockComment, color: '#5c5e6a', fontStyle: 'italic' },
  { tag: t.name, color: '#e4e4e7' },
  { tag: t.definition(t.variableName), color: '#c0a3e8' },
  { tag: t.propertyName, color: '#e4e4e7' },
  { tag: t.standard(t.name), color: '#78b6e8' },
]);

/* ── Dialect map ───────────────────────────────────────────────────────── */

const DIALECT_MAP: Record<string, typeof StandardSQL> = {
  mysql: MySQL,
  postgres: PostgreSQL,
  sqlite: SQLite,
};

function getSQLDialect(dialect: string) {
  return DIALECT_MAP[dialect] ?? StandardSQL;
}

/* ── Editor factory ────────────────────────────────────────────────────── */

export interface EditorInstance {
  view: EditorView;
  setDialect: (dialect: string) => void;
  getValue: () => string;
  setValue: (value: string) => void;
}

export function createEditor(
  parent: HTMLElement,
  options: {
    readonly?: boolean;
    placeholder?: string;
    initialDialect?: string;
    initialValue?: string;
    onChange?: (value: string) => void;
  } = {},
): EditorInstance {
  const dialectCompartment = new Compartment();
  const readonlyCompartment = new Compartment();

  const extensions = [
    forgeTheme,
    syntaxHighlighting(forgeHighlight),
    lineNumbers(),
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    dialectCompartment.of(sql({ dialect: getSQLDialect(options.initialDialect ?? '') })),
    readonlyCompartment.of(EditorState.readOnly.of(options.readonly ?? false)),
    EditorView.lineWrapping,
  ];

  if (options.placeholder) {
    extensions.push(cmPlaceholder(options.placeholder));
  }

  if (options.onChange) {
    const handler = options.onChange;
    extensions.push(
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          handler(update.state.doc.toString());
        }
      }),
    );
  }

  const state = EditorState.create({
    doc: options.initialValue ?? '',
    extensions,
  });

  const view = new EditorView({ state, parent });

  return {
    view,
    setDialect(dialect: string) {
      view.dispatch({
        effects: dialectCompartment.reconfigure(
          sql({ dialect: getSQLDialect(dialect) }),
        ),
      });
    },
    getValue() {
      return view.state.doc.toString();
    },
    setValue(value: string) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
    },
  };
}
