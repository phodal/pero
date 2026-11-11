import type { NodeViewProps } from '@tiptap/react';
import { BlockFrame } from './block-frame';

export function NoteCardView(view: NodeViewProps) {
  const text = typeof view.node.attrs.text === 'string' ? view.node.attrs.text : '';
  return <BlockFrame view={view} kind="noteCard">
    <p className="notebook-note">{text}</p>
  </BlockFrame>;
}
