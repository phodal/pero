import type { ScientificReference } from "./document.ts";

/** A reviewed reference change. Permission is not a field of this request. */
export interface ReferenceProposal {
  proposalId: string;
  expectedRevision: number;
  blockId: string;
  decision: "accept" | "reject";
  label: string;
  source: ScientificReference;
}

const id = /^[A-Za-z0-9_-]{1,128}$/;

export function referenceProposal(value: ReferenceProposal): ReferenceProposal {
  if (!value || typeof value !== "object") throw new Error("A reference proposal is required.");
  const keys = Object.keys(value).sort().join(",");
  if (keys !== "blockId,decision,expectedRevision,label,proposalId,source") throw new Error("A reference proposal cannot carry permission or extra fields.");
  if (!id.test(value.proposalId) || !id.test(value.blockId)) throw new Error("Proposal and block ids must be stable.");
  if (!Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 1) throw new Error("Expected revision is required.");
  if (value.decision !== "accept" && value.decision !== "reject") throw new Error("A proposal is accepted or rejected.");
  if (typeof value.label !== "string" || value.label.length > 200) throw new Error("Invalid proposed label.");
  const source = value.source;
  if (!source || ["app", "kind", "id", "version", "locator"].some(key => typeof source[key as keyof ScientificReference] !== "string")) throw new Error("The proposal needs the owner reference.");
  if (!source.app.trim() || !source.kind.trim() || !source.id.trim() || !source.version.trim()) throw new Error("The owner id and version stay explicit. An editor block id is not a version.");
  return {
    proposalId: value.proposalId,
    expectedRevision: value.expectedRevision,
    blockId: value.blockId,
    decision: value.decision,
    label: value.label,
    source: { app: source.app, kind: source.kind, id: source.id, version: source.version, locator: source.locator },
  };
}
