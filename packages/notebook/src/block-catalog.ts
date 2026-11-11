/**
 * One inventory of Notebook blocks. It names the existing owner of each type.
 * It does not validate, render, or replace the stored Notebook JSON.
 * A projection loss means that target cannot carry the block; it is not a second document.
 */

export type BlockProjection =
  | { readonly kind: "prose" }
  | { readonly kind: "reference" }
  | { readonly kind: "loss"; readonly code: string; readonly detail: string }
  | { readonly kind: "outside-subset" };

export interface BlockCatalogEntry {
  readonly type: string;
  /** A block can be stored in the document body. Inline and structural nodes cannot. */
  readonly group: "block" | "inline" | "structural";
  /** document-parser keeps the historical checker. document-definition is a registered scalar block. */
  readonly validation: "document-parser" | "document-definition";
  readonly projection: BlockProjection;
  /** Only a scientific reference review. Ordinary edits do not use it. */
  readonly command?: "propose_reference";
}

const tableLoss = {
  kind: "loss" as const,
  code: "table-content-is-not-measurement",
};

export const blockCatalog: readonly BlockCatalogEntry[] = [
  { type: "doc", group: "structural", validation: "document-parser", projection: { kind: "outside-subset" } },
  { type: "text", group: "inline", validation: "document-parser", projection: { kind: "prose" } },
  { type: "hardBreak", group: "inline", validation: "document-parser", projection: { kind: "prose" } },
  { type: "paragraph", group: "block", validation: "document-parser", projection: { kind: "prose" } },
  { type: "heading", group: "block", validation: "document-parser", projection: { kind: "prose" } },
  { type: "codeBlock", group: "block", validation: "document-parser", projection: { kind: "prose" } },
  { type: "blockquote", group: "block", validation: "document-parser", projection: { kind: "outside-subset" } },
  { type: "horizontalRule", group: "block", validation: "document-parser", projection: { kind: "outside-subset" } },
  { type: "bulletList", group: "block", validation: "document-parser", projection: { kind: "outside-subset" } },
  { type: "orderedList", group: "block", validation: "document-parser", projection: { kind: "outside-subset" } },
  { type: "taskList", group: "block", validation: "document-parser", projection: { kind: "outside-subset" } },
  { type: "listItem", group: "structural", validation: "document-parser", projection: { kind: "outside-subset" } },
  { type: "taskItem", group: "structural", validation: "document-parser", projection: { kind: "outside-subset" } },
  { type: "referenceMention", group: "inline", validation: "document-parser", projection: { kind: "outside-subset" } },
  { type: "section", group: "block", validation: "document-parser", projection: { kind: "outside-subset" } },
  { type: "evidence", group: "block", validation: "document-parser", projection: { kind: "reference" }, command: "propose_reference" },
  { type: "experiment", group: "block", validation: "document-parser", projection: { kind: "reference" }, command: "propose_reference" },
  { type: "finding", group: "block", validation: "document-parser", projection: { kind: "outside-subset" } },
  { type: "namedReference", group: "block", validation: "document-parser", projection: { kind: "outside-subset" } },
  { type: "sourceExcerpt", group: "block", validation: "document-parser", projection: { kind: "outside-subset" } },
  { type: "attachment", group: "block", validation: "document-parser", projection: { kind: "outside-subset" } },
  { type: "spreadsheet", group: "block", validation: "document-parser", projection: { kind: "loss", code: "formula-not-exported", detail: "Spreadsheet formulas stay in the notebook sheet. They are not BlockNote table cells, MyST phrasing cells, or a new computed result." } },
  { type: "inputTable", group: "block", validation: "document-parser", projection: { ...tableLoss, detail: "A structured table keeps its own rows, types, and units. BlockNote TableContent and MyST table cells are rich text, so this table was not exported." } },
  { type: "registrationTable", group: "block", validation: "document-parser", projection: { ...tableLoss, detail: "A registration table is not rich-text table content and was not exported." } },
  { type: "lookupTable", group: "block", validation: "document-parser", projection: { ...tableLoss, detail: "A lookup table is not rich-text table content and was not exported." } },
  { type: "reactionScheme", group: "block", validation: "document-parser", projection: { kind: "outside-subset" } },
  { type: "chemical", group: "block", validation: "document-parser", projection: { kind: "outside-subset" } },
  { type: "mixturePrep", group: "block", validation: "document-parser", projection: { kind: "outside-subset" } },
  { type: "sampleIntake", group: "block", validation: "document-parser", projection: { kind: "outside-subset" } },
  { type: "appCanvas", group: "block", validation: "document-parser", projection: { kind: "outside-subset" } },
  { type: "savedSearch", group: "block", validation: "document-parser", projection: { kind: "outside-subset" } },
  { type: "noteCard", group: "block", validation: "document-definition", projection: { kind: "outside-subset" } },
  { type: "mystDocument", group: "block", validation: "document-definition", projection: { kind: "loss", code: "myst-source-document", detail: "Use the MyST source or bundle export for this document. Its original source and metadata cannot be replaced by this prose-only projection." } },
  { type: "ipynbDocument", group: "block", validation: "document-definition", projection: { kind: "loss", code: "ipynb-source-document", detail: "Use the original .ipynb export to retain cell IDs, metadata, attachments, recorded outputs and unknown fields. This prose-only projection cannot replace the notebook source." } },
  { type: "mystProject", group: "block", validation: "document-definition", projection: { kind: "loss", code: "myst-project-snapshot", detail: "Use the MyST project snapshot export to retain every authored resource. Entry HTML is not a lossless project export." } },
  { type: "retainedBlock", group: "block", validation: "document-parser", projection: { kind: "loss", code: "retained-envelope", detail: "The original block is inside the retention envelope and was not converted." } },
];

export const persistedBlockTypes: readonly string[] = blockCatalog.filter(entry => entry.group === "block").map(entry => entry.type);

export function catalogEntry(type: string): BlockCatalogEntry | undefined {
  return blockCatalog.find(entry => entry.type === type);
}

export function lossProjection(entry: BlockCatalogEntry): { readonly code: string; readonly detail: string } | undefined {
  return entry.projection.kind === "loss" ? entry.projection : undefined;
}
