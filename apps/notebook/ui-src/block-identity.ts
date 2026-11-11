import { copyTemplateOrigin } from '@pero/notebook/templates';
import { copySourceExcerpt } from '@pero/notebook/source-excerpt';
import { UniqueID } from '@tiptap/extension-unique-id';
import { Fragment, Slice, type Node } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';
import type { CellAnnotation } from '@pero/notebook';

/** A copied research group gets new identities and keeps its internal citations. */
export function copyNotebookBlocks(slice: Slice): Slice {
  const ids = new Map<string, string>(), copiedAttachments = new Map<string, string>();
  slice.content.descendants(node => {
    if (node.attrs.blockId) {
      const id = crypto.randomUUID(); ids.set(node.attrs.blockId, id);
      if (node.type.name === 'attachment') copiedAttachments.set(node.attrs.blockId, id);
    }
    if (node.type.name === 'inputTable' || node.type.name === 'registrationTable') {
      ids.set(node.attrs.table.id, crypto.randomUUID());
      for (const row of node.attrs.table.rows) ids.set(row.id, crypto.randomUUID());
    }
  });
  const copiedInstances = new Map<string, string>();
  const references = (values: string[]) => values.map(id => ids.get(id) ?? id);
  const copy = (fragment: Fragment): Fragment => {
    const nodes: Node[] = [];
    fragment.forEach(node => {
      if (node.isText) { nodes.push(node); return; }
      const attrs = { ...node.attrs };
      if ('blockId' in attrs) attrs.blockId = ids.get(attrs.blockId) ?? crypto.randomUUID();
      if (node.type.name === 'inputTable' || node.type.name === 'registrationTable') {
        attrs.table = { ...attrs.table, id: ids.get(attrs.table.id), rows: attrs.table.rows.map((row: { id: string }) => ({ ...row, id: ids.get(row.id) })) };
      }
      if (attrs.templateOrigin) attrs.templateOrigin = copyTemplateOrigin(attrs.templateOrigin, ids, copiedInstances, () => crypto.randomUUID());
      if (node.type.name === 'retainedBlock' && attrs.payload && typeof attrs.payload === 'object') {
        const payload = { ...attrs.payload };
        if (payload.attrs && typeof payload.attrs === 'object') payload.attrs = { ...payload.attrs, blockId: attrs.blockId };
        attrs.payload = payload;
      }
      if (node.type.name === 'finding') attrs.evidenceIds = references(attrs.evidenceIds);
      if (node.type.name === 'sourceExcerpt') attrs.excerpt = copySourceExcerpt(attrs.excerpt, copiedAttachments);
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
