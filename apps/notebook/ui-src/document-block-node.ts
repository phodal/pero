import { Node } from '@tiptap/core';
import { ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import type { ComponentType } from 'react';
import { editorAdapter, type BlockIdentity, type BlockScalar, type DocumentBlockDefinition } from '@pero/notebook/scientific-block';

function readAttribute(element: HTMLElement, key: string, fallback: unknown) {
  const raw = element.getAttribute(`data-notebook-${key.toLowerCase()}`);
  if (raw === null) return fallback;
  try { return JSON.parse(raw) as unknown; }
  catch { return undefined; }
}

/** One TipTap node for any document-block definition. The type name is not branched here. */
export function documentBlockNode<Attrs extends BlockIdentity, Type extends string, Fields extends Record<string, BlockScalar>>(
  definition: DocumentBlockDefinition<Attrs, Type, Fields>,
  view: ComponentType<NodeViewProps>,
) {
  const adapter = editorAdapter(definition);
  return Node.create({
    name: adapter.name,
    group: 'block',
    atom: true,
    selectable: true,
    addAttributes() {
      return {
        // NotebookIdentity assigns IDs to null, including newly inserted blocks.
        blockId: { default: null, rendered: false },
        ...Object.fromEntries(Object.entries(adapter.defaults).map(([key, value]) => [key, {
          default: value, rendered: false,
        }])),
      };
    },
    parseHTML() {
      return [{
        tag: `div[data-notebook-block="${adapter.name}"]`,
        getAttrs: (element: HTMLElement) => {
          const attrs: Record<string, unknown> = { blockId: readAttribute(element, 'blockId', '') };
          for (const [key, value] of Object.entries(adapter.defaults)) attrs[key] = readAttribute(element, key, value);
          try {
            adapter.validate(attrs);
            return attrs;
          } catch { return false; }
        },
      }];
    },
    renderHTML({ node, HTMLAttributes }) {
      return ['div', {
        ...HTMLAttributes,
        'data-notebook-block': adapter.name,
        'data-notebook-blockid': JSON.stringify(node.attrs.blockId),
        ...Object.fromEntries(Object.keys(adapter.defaults).map(key => [`data-notebook-${key.toLowerCase()}`, JSON.stringify(node.attrs[key])])),
      }];
    },
    renderText() { return `[${adapter.name}]`; },
    addNodeView() { return ReactNodeViewRenderer(view as never); },
  });
}
