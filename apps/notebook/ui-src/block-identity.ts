import { UniqueID } from '@tiptap/extension-unique-id';
import { Fragment, Slice, type Node } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';
import type { CellAnnotation } from '@pero/notebook';

/** A copied research group gets new identities and keeps its internal citations. */
export function copyNotebookBlocks(slice: Slice): Slice {
  const ids = new Map<string, string>();
  slice.content.descendants(node => {
    if (node.attrs.blockId) ids.set(node.attrs.blockId, crypto.randomUUID());
  });
  const references = (values: string[]) => values.map(id => ids.get(id) ?? id);
  const copy = (fragment: Fragment): Fragment => {
    const nodes: Node[] = [];
    fragment.forEach(node => {
      if (node.isText) { nodes.push(node); return; }
      const attrs = { ...node.attrs };
      if ('blockId' in attrs) attrs.blockId = ids.get(attrs.blockId) ?? crypto.randomUUID();
      if (node.type.name === 'finding') attrs.evidenceIds = references(attrs.evidenceIds);
      if (node.type.name === 'spreadsheet') {
        attrs.annotations = Object.fromEntries(Object.entries(attrs.annotations as Record<string, CellAnnotation>)
          .map(([address, annotation]) => [address, { ...annotation, evidenceIds: references(annotation.evidenceIds) }]));
      }
      nodes.push(node.type.create(attrs, copy(node.content), node.marks));
    });
    return Fragment.from(nodes);
  };
  return new Slice(copy(slice.content), slice.openStart, slice.openEnd);
}

// Retain UniqueID's paste/copy-vs-move detection and normal edit identity rules.
// When it would strip IDs, remap the original slice instead, before insertion.
export const NotebookIdentity = UniqueID.extend({
  addProseMirrorPlugins() {
    return (this.parent?.() ?? []).map(plugin => {
      const transform = plugin.props.transformPasted;
      if (!transform) return plugin;
      return new Plugin({
        ...plugin.spec,
        props: {
          ...plugin.props,
          transformPasted(slice, view, plain) {
            return transform.call(plugin, slice, view, plain) === slice ? slice : copyNotebookBlocks(slice);
          },
        },
      });
    });
  },
});
