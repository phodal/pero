import type { ScientificReference } from "./document.ts";

/** A user review of a proposal the Host agent already stored. */
export interface ReferenceReview {
  proposalId: string;
  expectedRevision: number;
  decision: "accept" | "reject";
}

const id = /^[A-Za-z0-9_-]{1,128}$/;

export function referenceReview(value: ReferenceReview): ReferenceReview {
  if (!value || typeof value !== "object") throw new Error("A reference review is required.");
  if (Object.keys(value).sort().join(",") !== "decision,expectedRevision,proposalId") throw new Error("A review cannot carry a new reference or a permission field.");
  if (!id.test(value.proposalId)) throw new Error("Proposal id must be stable.");
  if (!Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 1) throw new Error("Expected revision is required.");
  if (value.decision !== "accept" && value.decision !== "reject") throw new Error("A proposal is accepted or rejected.");
  return { proposalId: value.proposalId, expectedRevision: value.expectedRevision, decision: value.decision };
}

export type StoredReferenceProposal = {
  proposalId: string;
  decision: "pending" | "accept" | "reject";
  blockId: string;
  label: string;
  source: ScientificReference;
  revision: number;
};

/**
 * A new document block. Version 1 is the editor contract. A later integer
 * version is retained by validate and is not interpreted by this editor.
 */
export interface DocumentBlockDefinition {
  type: "noteCard";
  schemaVersion: 1;
  role: "document";
  defaults: { schemaVersion: 1; text: string };
  validate(attrs: Record<string, unknown>): void;
}

/** Historical evidence and experiment. The only command is propose_reference. */
export interface ReferenceBlockDefinition {
  type: "evidence" | "experiment";
  schemaVersion: 1;
  role: "reference";
  command: "propose_reference";
}

const noteFields = ["blockId", "schemaVersion", "text", "templateOrigin"];

export const noteCardDefinition: DocumentBlockDefinition = {
  type: "noteCard",
  schemaVersion: 1,
  role: "document",
  defaults: { schemaVersion: 1, text: "" },
  validate(attrs) {
    const version = attrs.schemaVersion;
    if (typeof version !== "number" || !Number.isInteger(version) || version < 1) throw new Error("Invalid note card schema version.");
    if (typeof attrs.blockId !== "string" || !id.test(attrs.blockId)) throw new Error("Note card id must be stable.");
    if (version !== 1) return;
    if (typeof attrs.text !== "string" || attrs.text.length > 4000) throw new Error("Invalid note card text.");
    if (Object.keys(attrs).some(key => !noteFields.includes(key))) throw new Error("Invalid note card fields.");
  },
};

export const referenceBlocks: readonly ReferenceBlockDefinition[] = [
  { type: "evidence", schemaVersion: 1, role: "reference", command: "propose_reference" },
  { type: "experiment", schemaVersion: 1, role: "reference", command: "propose_reference" },
];

export function editorAdapter(definition: DocumentBlockDefinition) {
  return { name: definition.type, defaults: definition.defaults, validate: definition.validate };
}
