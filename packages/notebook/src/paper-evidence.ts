import type { ScientificReference } from "./document.ts";

export const maxPaperReportBytes = 2 * 1024 * 1024;

const reportSchema = "pero.paper-agent-report.v1";
const idPattern = /^[a-f0-9]{64}$/;
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const maxCitationIndex = 12 * 8 - 1;
const maxPosition = 2_147_483_647;
const maxQuote = 4_000;
const maxPassage = 32_768;
const encoder = new TextEncoder();

export interface PaperCitationEvidence {
  reportId: string;
  intentId: string;
  exportSha256: string;
  citationIndex: number;
  paperId: string;
  paperContentDigest: string;
  passageId: string;
  documentId: string;
  fileDigest: string;
  page: number;
  /** First matching span, in page-relative Unicode code points, as returned by the Paper owner. */
  start: number;
  end: number;
  quote: string;
  /** Exact occurrences within the frozen passage, including overlaps. */
  occurrences: number;
}

export interface ImportedPaperReport {
  reportId: string;
  title: string;
  exportSha256: string;
  citations: { label: string; reference: ScientificReference; evidence: PaperCitationEvidence }[];
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length === 64 && idPattern.test(value);
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && value.length === 71 && digestPattern.test(value);
}

function isInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && minimum <= value && value <= maximum;
}

function characters(value: string): number {
  return Array.from(value).length;
}

function isText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && !!value.trim() && characters(value) <= maximum;
}

export function isPaperCitationEvidence(value: unknown): value is PaperCitationEvidence {
  if (!isObject(value)) return false;
  const { reportId, intentId, exportSha256, citationIndex, paperId, paperContentDigest,
    passageId, documentId, fileDigest, page, start, end, quote, occurrences } = value;
  return isId(reportId) && isId(intentId) && isId(exportSha256)
    && isInteger(citationIndex, 0, maxCitationIndex) && isId(paperId) && isDigest(paperContentDigest)
    && isId(passageId) && isId(documentId) && isId(fileDigest)
    && isInteger(page, 1, maxPosition) && isInteger(start, 0, maxPosition)
    && isInteger(end, start + 1, maxPosition) && isText(quote, maxQuote)
    && end - start === characters(quote) && isInteger(occurrences, 1, maxPassage);
}

export function isPaperCitationSnapshot(value: unknown): value is PaperCitationEvidence & { kind: "paper-report" } {
  return isObject(value) && value.kind === "paper-report" && Object.keys(value).length === 15
    && isPaperCitationEvidence(value);
}

function items(value: unknown, limit: number, name: string): unknown[] {
  if (!Array.isArray(value) || value.length > limit) throw new Error(`Invalid Paper Agent ${name}.`);
  return value;
}

/** The hashed owner records have fixed ASCII keys and no floating-point fields. */
function canonical(value: unknown, depth = 0): string {
  if (depth > 16) throw new Error("Paper Agent report is nested too deeply.");
  if (Array.isArray(value)) {
    return "[" + value.map((entry) => canonical(entry, depth + 1)).join(",") + "]";
  }
  if (isObject(value)) {
    return "{" + Object.keys(value).sort().map((key) =>
      JSON.stringify(key) + ":" + canonical(value[key], depth + 1),
    ).join(",") + "}";
  }
  return JSON.stringify(value);
}

async function sha256(bytes: BufferSource): Promise<string> {
  const result = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(result), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function ownerId(value: JsonObject): Promise<string> {
  return sha256(encoder.encode(canonical(value)));
}

/**
 * Check a saved Paper Agent JSON export and extract its section citations.
 * The export has no signature, original PDF bytes, or complete frozen research input.
 */
export async function readPaperEvidence(bytes: ArrayBuffer): Promise<ImportedPaperReport> {
  if (bytes.byteLength === 0 || bytes.byteLength > maxPaperReportBytes) {
    throw new Error("Choose a nonempty Paper Agent JSON export up to 2 MB.");
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("Paper Agent export must be valid UTF-8 JSON.");
  }

  if (!isObject(value) || value.schema !== reportSchema || value.acceptance !== "unverified"
      || !isId(value.id) || !isId(value.intentId) || !isDigest(value.inputDigest)
      || !isText(value.title, 200) || encoder.encode(value.title).length > 200
      || !isText(value.limitations, 8_000)) {
    throw new Error("Choose a saved Paper Agent research report JSON export.");
  }

  const { id: reportId, intentId, title, binding, retrieval } = value;
  if (!isObject(retrieval)) throw new Error("The report has no frozen PDF retrieval.");
  if (!isObject(binding) || !isText(binding.provenance, 100)
      || ("sessionId" in binding && !isText(binding.sessionId, 250))
      || Object.keys(binding).some((key) => key !== "provenance" && key !== "sessionId")) {
    throw new Error("Invalid Paper Agent report binding.");
  }

  const sections = items(value.sections, 12, "report sections");
  const experiments = items(value.experiments, 6, "report experiments");
  if ("matrix" in value && !isObject(value.matrix)) throw new Error("Invalid Paper Agent report matrix.");
  const reportIdentity = {
    schema: value.schema, intentId, title, sections, experiments, limitations: value.limitations,
    acceptance: value.acceptance, binding, inputDigest: value.inputDigest,
    ...("matrix" in value ? { matrix: value.matrix } : {}),
  };
  if (await ownerId(reportIdentity) !== reportId) {
    throw new Error("Paper Agent report ID does not match its content.");
  }

  const sources = new Map<string, { title: string; contentDigest: string; localFileDigest?: string }>();
  for (const source of items(value.sources, 5, "frozen sources")) {
    if (!isObject(source) || !isId(source.id) || !isText(source.title, 1_000)
        || !isDigest(source.contentDigest) || sources.has(source.id)) {
      throw new Error("Invalid Paper Agent frozen source.");
    }
    let localFileDigest: string | undefined;
    if (source.source === "local-pdf") {
      if (!isId(source.sourceId) || source.url !== "urn:sha256:" + source.sourceId) {
        throw new Error("Paper Agent local PDF source identity does not match.");
      }
      localFileDigest = source.sourceId;
    }
    sources.set(source.id, { title: source.title, contentDigest: source.contentDigest, localFileDigest });
  }

  const passageRecords = items(value.passages, 1_000, "frozen passages");
  const retrievalPassages = items(retrieval.passageIds, 1_000, "retrieval passages");
  const retrievalSources = items(retrieval.sourceIds, 5, "retrieval sources");
  if (!passageRecords.length || retrievalPassages.length !== passageRecords.length
      || !retrievalSources.every(isId)) {
    throw new Error("Paper Agent retrieval does not match the frozen passages.");
  }
  const documents = new Set(retrievalSources);
  const passages = new Map<string, {
    paperId: string; documentId: string; fileDigest: string; page: number; start: number; content: string;
  }>();
  for (const [index, passage] of passageRecords.entries()) {
    if (!isObject(passage) || !isId(passage.id) || !isId(passage.paperId)
        || !isId(passage.documentId) || !isId(passage.fileDigest)
        || !isInteger(passage.page, 1, maxPosition) || !isInteger(passage.start, 0, maxPosition - maxPassage)
        || !isText(passage.content, maxPassage) || passages.has(passage.id)
        || retrievalPassages[index] !== passage.id || !documents.has(passage.documentId)) {
      throw new Error("Paper Agent retrieval does not match the frozen passages.");
    }
    const { paperId, documentId, fileDigest, page, start, content } = passage;
    const source = sources.get(paperId);
    if (!source || (source.localFileDigest && source.localFileDigest !== fileDigest)
        || await ownerId({ paperId, fileDigest }) !== documentId) {
      throw new Error("Paper Agent PDF document identity does not match its paper and file.");
    }
    if (await ownerId({ documentId, page, start, content }) !== passage.id) {
      throw new Error("Paper Agent passage identity does not match its location and text.");
    }
    passages.set(passage.id, { paperId, documentId, fileDigest, page, start, content });
  }

  const exportSha256 = await sha256(bytes);
  const citations: ImportedPaperReport["citations"] = [];
  for (const section of sections) {
    if (!isObject(section)) throw new Error("Invalid Paper Agent report section.");
    const paperIds = items(section.paperIds, 8, "section sources");
    const references = items(section.evidence, 8, "section citations");
    if (!references.length || !paperIds.length || !paperIds.every((id) => isId(id) && sources.has(id))) {
      throw new Error("A Paper Agent PDF section is missing frozen citations.");
    }
    for (const reference of references) {
      if (!isObject(reference) || !isId(reference.paperId) || !paperIds.includes(reference.paperId)
          || !isId(reference.passageId) || !isText(reference.quote, maxQuote)) {
        throw new Error("Paper Agent citation does not name a frozen section source.");
      }
      const { paperId, passageId, quote } = reference;
      const passage = passages.get(passageId);
      const source = sources.get(paperId);
      if (!passage || !source || passage.paperId !== paperId) {
        throw new Error("Paper Agent citation does not match its frozen paper and passage.");
      }

      const first = passage.content.indexOf(quote);
      if (first < 0) throw new Error("Paper Agent citation quote is not exact in the frozen passage.");
      let occurrences = 0;
      for (let offset = first; offset >= 0; offset = passage.content.indexOf(quote, offset + 1)) occurrences++;
      const { page, documentId, fileDigest } = passage;
      const start = passage.start + characters(passage.content.slice(0, first));
      const end = start + characters(quote);
      const citationIndex = citations.length;
      const locator = `pero-app-location://paper-agent/main/report/${reportId}/citation/${citationIndex}`;
      const label = Array.from(source.title).slice(0, 180).join("") + ` · p. ${page}`;
      citations.push({
        label,
        reference: { app: "paper-agent", kind: "report-citation", id: reportId, version: reportId, locator },
        evidence: {
          reportId, intentId, exportSha256, citationIndex, paperId, paperContentDigest: source.contentDigest,
          passageId, documentId, fileDigest, page, start, end, quote, occurrences,
        },
      });
    }
  }
  if (!citations.length) throw new Error("The Paper Agent report contains no frozen PDF citations.");
  return { reportId, title, exportSha256, citations };
}
