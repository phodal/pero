import { SourceExcerptView } from './source-excerpt';
import { ReactionSchemeView, ChemicalView } from './scientific-content';
import { emptyReaction, emptyMolecularGraph } from '@pero/notebook/scientific-designs';
import { NotebookCodeBlock } from './code-block';
import { ReferenceMention } from './reference-mention';
import { SampleIntakeView } from './sample-intake';
import { sampleIntakeDefaults } from '@pero/notebook/sample-intake';
import { Node } from '@tiptap/core';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { ReactNodeViewRenderer } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { isClipboardWidget } from './clipboard-block';
import { NotebookIdentity } from './block-identity';
import { ExperimentView, EvidenceView, FindingView } from './research-blocks';
import { SpreadsheetView } from './spreadsheet';
import { messages } from './messages';
import { AttachmentView, Section, attachmentDefaults } from './content-blocks';
import { NotebookTextColor, NotebookTextBackground, NotebookSubscript, NotebookSuperscript, NotebookLinkPaste, notebookLinkOptions } from './text-tools';
import { InputTableView, RegistrationTableView, LookupTableView } from './structured-table';
import { structuredTableDefaults, lookupTableDefaults } from '@pero/notebook/structured-table';
import { AppCanvasView } from './app-canvas';
import { MixturePrepView } from './mixture';
import { emptyMixturePreparation } from '@pero/notebook/mixture';
import { NotebookTemplateOrigin } from './template-origin';
import { SavedSearchView } from './saved-search';

export const widgets = [
  { name: 'sourceExcerpt', icon: 'document', defaults: { label: '', excerpt: null }, view: SourceExcerptView },
  { name: 'reactionScheme', icon: 'flask', defaults: { reaction: emptyReaction(), record: null }, view: ReactionSchemeView },
  { name: 'chemical', icon: 'flask', defaults: { chemical: { name: '', graph: emptyMolecularGraph(), source: null } }, view: ChemicalView },
  { name: 'sampleIntake', icon: 'flask', defaults: sampleIntakeDefaults, view: SampleIntakeView },
  { name: 'appCanvas', icon: 'document', defaults: { label: '', binding: null }, view: AppCanvasView },
  { name: 'mixturePrep', icon: 'flask', defaults: { label: '', mixture: emptyMixturePreparation() }, view: MixturePrepView },
  { name: 'savedSearch', icon: 'search', defaults: { label: '', queryId: '', queryRevision: 1, mode: 'live', snapshot: null }, view: SavedSearchView },
  { name: 'inputTable', icon: 'table', defaults: structuredTableDefaults, view: InputTableView },
  { name: 'registrationTable', icon: 'table', defaults: structuredTableDefaults, view: RegistrationTableView },
  { name: 'lookupTable', icon: 'search', defaults: lookupTableDefaults, view: LookupTableView },
  { name: 'attachment', icon: 'file', defaults: attachmentDefaults, view: AttachmentView },
  { name: 'spreadsheet', icon: 'table', defaults: { label: '', sheet: { rows: 5, columns: 5, cells: {} }, annotations: {}, formats: {}, rowHeights: {}, columnWidths: {}, merges: [] }, view: SpreadsheetView },
  { name: 'evidence', icon: 'document', defaults: { label: '', source: null, snapshot: null }, view: EvidenceView },
  { name: 'experiment', icon: 'flask', defaults: { label: '', source: null, snapshot: null }, view: ExperimentView },
  { name: 'finding', icon: 'search', defaults: { claim: '', limitations: '', evidenceIds: [] }, view: FindingView },
] as const;

const addressed = ['section', 'paragraph', 'heading', 'blockquote', 'horizontalRule', 'codeBlock', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem',
  ...widgets.map(widget => widget.name)];

function readAttribute(element: HTMLElement, key: string, fallback: unknown) {
  const raw = element.getAttribute(`data-notebook-${key.toLowerCase()}`);
  if (raw === null) return fallback;
  try { return JSON.parse(raw) as unknown; }
  catch { return undefined; }
}

export const notebookExtensions = [
  StarterKit.configure({ codeBlock: false, link: notebookLinkOptions, trailingNode: false }),
  NotebookTextColor, NotebookTextBackground, NotebookSubscript, NotebookSuperscript, NotebookLinkPaste, Section,
  NotebookCodeBlock, ReferenceMention,
  TaskList,
  TaskItem.configure({ nested: true }),
  ...widgets.map(widget => Node.create({
    name: widget.name,
    group: 'block',
    atom: true,
    selectable: true,
    addAttributes() {
      return Object.fromEntries(Object.entries(widget.defaults).map(([key, value]) => [key, {
        default: value, rendered: false, parseHTML: () => null,
      }]));
    },
    parseHTML() {
      return [{
        tag: `div[data-notebook-block="${widget.name}"]`,
        getAttrs: (element: HTMLElement) => {
          const attrs = Object.fromEntries(Object.entries(widget.defaults).map(([key, value]) => [
            key, readAttribute(element, key, value),
          ]));
          return isClipboardWidget(widget.name, attrs) ? attrs : false;
        },
      }];
    },
    renderHTML({ node, HTMLAttributes }) {
      return ['div', {
        ...HTMLAttributes,
        'data-notebook-block': widget.name,
        ...Object.fromEntries(Object.keys(widget.defaults).map(key => [`data-notebook-${key.toLowerCase()}`, JSON.stringify(node.attrs[key])])),
      }];
    },
    renderText() { return `[${messages[widget.name].en}]`; },
    addNodeView() { return ReactNodeViewRenderer(widget.view); },
  })),
  NotebookTemplateOrigin.configure({ types: addressed }),
  NotebookIdentity.configure({ attributeName: 'blockId', types: addressed }),
];

