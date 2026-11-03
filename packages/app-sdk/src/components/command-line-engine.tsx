// Upstream attribution and license: packages/app-sdk/NOTICE.md.
import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { StreamLanguage, defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { shell } from '@codemirror/legacy-modes/mode/shell';

const theme = EditorView.theme({
  '&': { height: 'auto', backgroundColor: 'transparent', color: 'var(--pero-source-foreground, var(--pero-text))' },
  '.cm-scroller': { overflowX: 'auto', overflowY: 'hidden', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '12px', lineHeight: '20px' },
  '.cm-content': { padding: '4px 8px', whiteSpace: 'pre', caretColor: 'transparent' },
  '.cm-line': { padding: 0 },
  '.cm-gutters': { display: 'none' },
  '&.cm-focused': { outline: 'none' },
});

export type CommandLineProps = { value: string; label: string };

/** Read-only one-line shell command with CodeMirror highlighting. */
export function CommandLineEngine({ value, label }: CommandLineProps) {
  const holder = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  useEffect(() => {
    const parent = holder.current;
    if (!parent) return undefined;
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: value,
        extensions: [
          StreamLanguage.define(shell),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.contentAttributes.of({ 'aria-label': label, 'aria-readonly': 'true' }),
          theme,
        ],
      }),
    });
    viewRef.current = view;
    return () => { view.destroy(); viewRef.current = null; };
  }, [label]);
  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value]);
  return <div ref={holder} />;
}
