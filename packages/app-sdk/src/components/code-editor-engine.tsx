// Adapted from Point App SDK (Apache-2.0), source revision 872cbf87d.
import { useEffect, useRef } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
import { StreamLanguage, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { tags } from '@lezer/highlight';

const KEYWORD = /^(?:classDiagram|erDiagram|flowchart|stateDiagram-v2|stateDiagram|sequenceDiagram|class|namespace|participant|actor|direction|note|graph)\b/;
const ARROW = /^(?:<\|--|--\|>|<\|\.\.|o--|\*--|-->|<--|==>|--|\.\.>)/;

/** A small Mermaid stream. Keywords, arrows, comments, quoted text and types are distinct. */
const mermaid = StreamLanguage.define({
  startState: () => ({ afterColon: false, expectType: false }),
  token(stream, state: { afterColon: boolean; expectType: boolean }) {
    if (stream.eatSpace()) return null;
    if (stream.match('%%')) { stream.skipToEnd(); return 'comment'; }
    if (stream.peek() === '"') {
      stream.next();
      while (!stream.eol()) {
        if (stream.next() === '"') break;
      }
      return 'string';
    }
    if (stream.match(KEYWORD)) {
      state.afterColon = false;
      state.expectType = stream.current() === 'class';
      return 'keyword';
    }
    if (stream.match(ARROW)) { state.afterColon = false; state.expectType = false; return 'operator'; }
    if (stream.match(/^[+#\-~*]/)) { state.afterColon = false; state.expectType = true; return 'operator'; }
    if (stream.match(/^[{}()[\]]/)) return 'bracket';
    if (stream.match(':')) { state.afterColon = true; state.expectType = false; return 'operator'; }
    if (stream.match(/^[A-Za-z_][\w$]*/)) {
      const word = stream.current();
      const kind = state.afterColon || state.expectType || /^[A-Z]/.test(word) || /^(?:string|int|integer|decimal|float|double|bool|boolean|date|number|long|byte|char)$/i.test(word) ? 'type' : 'variable';
      state.afterColon = false;
      state.expectType = false;
      return kind;
    }
    if (stream.match(/^\d+/)) return 'number';
    stream.next();
    state.afterColon = false;
    state.expectType = false;
    return null;
  },
});

// A static class and a color cannot be combined: HighlightStyle uses the class
// and drops the color. The colors live in ui-styles next to these class names.
const colors = HighlightStyle.define([
  { tag: tags.keyword, class: 'cm-mermaid-keyword' },
  { tag: tags.comment, class: 'cm-mermaid-comment' },
  { tag: [tags.string, tags.number], class: 'cm-mermaid-literal' },
  { tag: tags.typeName, class: 'cm-mermaid-type' },
  { tag: tags.operator, class: 'cm-mermaid-operator' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--pero-source-background, var(--pero-surface))', color: 'var(--pero-source-foreground, var(--pero-text))' },
  '.cm-scroller': { height: '100%', minHeight: '0', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '12px', overflow: 'auto' },
  '.cm-content': { padding: '8px 0' },
  '.cm-gutters': { backgroundColor: 'var(--pero-source-gutter, var(--pero-surface-muted))', color: 'var(--pero-source-muted, var(--pero-text-muted))', borderRight: '1px solid var(--pero-source-border, var(--pero-border))' },
  '.cm-activeLine': { backgroundColor: 'var(--pero-source-selection, var(--pero-fill-hover))' },
  '&.cm-focused': { outline: '2px solid var(--pero-source-accent, var(--pero-action))', outlineOffset: '-2px' },
  '.cm-cursor': { borderLeftColor: 'var(--pero-source-foreground, var(--pero-text))' },
});

export type CodeEditorProps = {
  id?: string;
  value: string;
  label: string;
  disabled?: boolean;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  onChange: (value: string) => void;
};

/** Editable source. The caller owns the text; this view only reports edits. */
export function CodeEditorEngine({ id, value, label, disabled = false, onChange, ...aria }: CodeEditorProps) {
  const holder = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const access = useRef(new Compartment());
  const editing = useRef(new Compartment());
  onChangeRef.current = onChange;

  useEffect(() => {
    const parent = holder.current;
    if (!parent) return;
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: value,
        extensions: [
          mermaid,
          syntaxHighlighting(colors),
          lineNumbers(),
          highlightActiveLine(),
          drawSelection(),
          history(),
          keymap.of([indentWithTab, ...historyKeymap, ...defaultKeymap]),
          access.current.of(EditorView.contentAttributes.of({
            id: id ?? '',
            'aria-label': label,
            'aria-describedby': aria['aria-describedby'] ?? '',
            'aria-invalid': aria['aria-invalid'] ? 'true' : 'false',
            'aria-readonly': String(disabled), 'aria-disabled': String(disabled),
          })),
          editing.current.of([EditorState.readOnly.of(disabled), EditorView.editable.of(!disabled)]),
          EditorView.updateListener.of(update => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
          theme,
        ],
      }),
    });
    viewRef.current = view;
    return () => { viewRef.current = null; view.destroy(); };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: [
        access.current.reconfigure(EditorView.contentAttributes.of({
          id: id ?? '',
          'aria-label': label,
          'aria-describedby': aria['aria-describedby'] ?? '',
          'aria-invalid': aria['aria-invalid'] ? 'true' : 'false',
            'aria-readonly': String(disabled), 'aria-disabled': String(disabled),
        })),
        editing.current.reconfigure([EditorState.readOnly.of(disabled), EditorView.editable.of(!disabled)]),
      ],
    });
  }, [id, label, disabled, aria['aria-describedby'], aria['aria-invalid']]);

  return <div className="pero-source-pane" ref={holder} />;
}
