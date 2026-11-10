import type { PaperCitationEvidence } from "./paper-evidence.ts";
import type { ControlEvidenceSnapshot } from "./control-evidence.ts";
import type { TemplateOrigin } from "./templates.ts";
import type { EntryIdentity, EntryNotice } from "./entry-record.ts";
import type { NotebookMetadata, NotebookProcedure } from "./workspace.ts";

/** The editor tree is the persisted content of a Notebook revision. */
export interface NotebookNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: NotebookNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
}

export interface NotebookDocument {
  schemaVersion: 1;
  title: string;
  content: NotebookNode & { type: "doc"; content: NotebookNode[] };
  metadata?: NotebookMetadata;
  procedures?: NotebookProcedure[];
  templateOrigin?: TemplateOrigin;
  identity?: EntryIdentity;
  notices?: EntryNotice[];
}

/** The owner ID locates the live object. The version identifies the cited snapshot. */
export interface ScientificReference {
  app: string;
  kind: string;
  id: string;
  version: string;
  locator: string;
}

export type ReferenceSnapshot = (PaperCitationEvidence & { kind: "paper-report" }) | ControlEvidenceSnapshot;

/** Completeness of the recorded identity, not verification by the owning App. */
export type ScientificReferenceState = "missing" | "partial" | "unpinned" | "pinned";

export function scientificReferenceState(source: ScientificReference | null | undefined): ScientificReferenceState {
  if (!source) return "missing";
  if (!source.app.trim() || !source.kind.trim() || !source.id.trim()) return "partial";
  return source.version.trim() ? "pinned" : "unpinned";
}

export interface CellAnnotation {
  unit: string;
  evidenceIds: string[];
  url?: string;
}

/** Empty clears the link. Only http and https addresses are kept. */
export function parseCellUrl(value: string): string | null {
  const text = value.trim();
  if (!text) return '';
  if (text.length > 2048) return null;
  let url: URL;
  try { url = new URL(text); } catch { return null; }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) return null;
  return url.toString();
}

export function parsePaperCitation(value: string): ScientificReference | null {
  const locator = value.trim();
  const match = /^pero-app-location:\/\/paper-agent\/main\/report\/([a-f0-9]{64})\/(citation\/[0-9]{1,9}|passage\/[a-f0-9]{64})$/.exec(locator);
  if (!match) return null;
  const [, reportId, target] = match;
  return {
    app: "paper-agent",
    kind: target.startsWith("citation/") ? "report-citation" : "report-passage",
    id: reportId,
    version: reportId,
    locator,
  };
}

export interface NotebookEntrySummary {
  id: string;
  title: string;
  revision: number;
  updatedAt: string;
}

export interface NotebookEntry extends NotebookEntrySummary {
  document: NotebookDocument;
}

export const spreadsheetLimits = { rows: 200, columns: 50, cellLength: 4096 } as const;

export function createNotebookDocument(title = "Untitled notebook"): NotebookDocument {
  return {
    schemaVersion: 1,
    title,
    content: { type: "doc", content: [{ type: "paragraph" }] },
  };
}
