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
