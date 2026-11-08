import type { Node } from '@tiptap/pm/model';
import { scientificReferenceState, type ScientificReference } from '@pero/notebook';

interface NotebookEvidence {
  id: string;
  label: string;
  kind: 'evidence' | 'experiment';
  pinned: boolean;
  imported: boolean;
}

/** Project editor blocks into the evidence choices used by Findings and cells. */
export function notebookEvidence(document: Node): NotebookEvidence[] {
  const sources: NotebookEvidence[] = [];
  document.descendants(node => {
    const kind = node.type.name;
    if ((kind !== 'evidence' && kind !== 'experiment') || !node.attrs.blockId) return;
    const { blockId, label, source, snapshot } = node.attrs as {
      blockId: string; label: string; source: ScientificReference | null; snapshot: unknown;
    };
    sources.push({
      id: blockId, label: label || source?.id || '', kind,
      pinned: scientificReferenceState(source) === 'pinned', imported: !!snapshot,
    });
  });
  return sources;
}
