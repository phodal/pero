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
  baseRevision: number;
  revision: number;
};

const blockTypeName = /^[A-Za-z][A-Za-z0-9_-]{0,64}$/;

/** Values a document block can declare without a payload engine. */
export type BlockScalar = string | number | boolean | null;

export interface BlockIdentity {
  blockId: string;
  schemaVersion: number;
}

/**
 * A document block. The type name and defaults come from the definition,
 * not from this interface. Version 1 checks those defaults. A later integer
 * schemaVersion is returned unchanged.
 */
export interface DocumentBlockDefinition<
  Attrs extends BlockIdentity,
  Type extends string,
  Fields extends Record<string, BlockScalar>,
> {
  readonly type: Type;
  readonly schemaVersion: 1;
  readonly role: "document";
  readonly defaults: { readonly schemaVersion: 1 } & Fields;
  validate(value: unknown): Attrs;
}

/** A reference block. The only command is propose_reference. The type name is not enumerated here. */
export interface ReferenceBlockDefinition {
  readonly type: string;
  readonly schemaVersion: 1;
  readonly role: "reference";
  readonly command: "propose_reference";
}

export function defineDocumentBlock<Type extends string, Fields extends Record<string, BlockScalar>>(spec: {
  type: Type;
  defaults: Fields;
  versionOne(attrs: { blockId: string; schemaVersion: 1 } & Fields): void;
}): DocumentBlockDefinition<{ blockId: string; schemaVersion: number } & Fields, Type, Fields> {
  if (!blockTypeName.test(spec.type)) throw new Error("Invalid block type name.");
  if ("schemaVersion" in spec.defaults || "blockId" in spec.defaults) throw new Error("schemaVersion and blockId belong to the block contract, not its field defaults.");
  for (const [key, value] of Object.entries(spec.defaults)) {
    if (!isScalar(value)) throw new Error(`Invalid default for ${key}.`);
  }
  const defaults = { schemaVersion: 1 as const, ...spec.defaults };
  return {
    type: spec.type,
    schemaVersion: 1,
    role: "document",
    defaults,
    validate(value) {
      const record = recordOf(value);
      const blockId = record.blockId;
      if (typeof blockId !== "string" || !id.test(blockId)) throw new Error("Block id must be stable.");
      const version = record.schemaVersion;
      if (typeof version !== "number" || !Number.isInteger(version) || version < 1) throw new Error("Invalid block schema version.");
      const parsed = record as { blockId: string; schemaVersion: number } & Fields;
      if (version !== 1) return parsed;
      const allowed = new Set(["blockId", "schemaVersion", "templateOrigin", ...Object.keys(spec.defaults)]);
      if (Object.keys(record).some(key => !allowed.has(key))) throw new Error("Invalid document block fields.");
      for (const [key, sample] of Object.entries(spec.defaults)) {
        const got = record[key];
        if (sample === null ? got !== null : typeof got !== typeof sample) throw new Error(`Invalid document block ${key}.`);
      }
      spec.versionOne(parsed as { blockId: string; schemaVersion: 1 } & Fields);
      return parsed;
    },
  };
}

export function defineReferenceBlock(type: string): ReferenceBlockDefinition {
  if (!blockTypeName.test(type)) throw new Error("Invalid block type name.");
  return { type, schemaVersion: 1, role: "reference", command: "propose_reference" };
}

const documents = new Map<string, { readonly type: string; validate(value: unknown): BlockIdentity }>();

export function registerDocumentBlock<Attrs extends BlockIdentity, Type extends string, Fields extends Record<string, BlockScalar>>(
  definition: DocumentBlockDefinition<Attrs, Type, Fields>,
): DocumentBlockDefinition<Attrs, Type, Fields> {
  if (documents.has(definition.type)) throw new Error(`Duplicate block registration: ${definition.type}`);
  documents.set(definition.type, definition);
  return definition;
}

export function unregisterDocumentBlock(type: string) {
  documents.delete(type);
}

export function registeredDocumentBlock(type: string): { readonly type: string; validate(value: unknown): BlockIdentity } | undefined {
  return documents.get(type);
}

export function editorAdapter<Attrs extends BlockIdentity, Type extends string, Fields extends Record<string, BlockScalar>>(
  definition: DocumentBlockDefinition<Attrs, Type, Fields>,
) {
  return {
    name: definition.type,
    role: definition.role,
    defaults: definition.defaults,
    validate: (value: unknown) => definition.validate(value),
  };
}

function isScalar(value: unknown): value is BlockScalar {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function recordOf(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid document block.");
  return value as Record<string, unknown>;
}

export const noteCardDefinition = registerDocumentBlock(defineDocumentBlock({
  type: "noteCard",
  defaults: { text: "" },
  versionOne(attrs) {
    if (attrs.text.length > 4000) throw new Error("Invalid note card text.");
  },
}));

export const evidenceReference = defineReferenceBlock("evidence");
export const experimentReference = defineReferenceBlock("experiment");
