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
}

/** The owner ID locates the live object. The version identifies the cited snapshot. */
export interface ScientificReference {
  app: string;
  kind: string;
  id: string;
  version: string;
  locator: string;
}

export interface CellAnnotation {
  unit: string;
  evidenceIds: string[];
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
