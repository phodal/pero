export type Paper = {
  id: string; source: string; sourceId: string; title: string; authors: string[];
  url: string; pdfUrl?: string; contentKind: 'abstract' | 'report' | 'full-text';
  contentDigest: string; fetchedAt: string; content?: string;
};
export type Intent = {
  id: string; createdAt?: string; question: string; requestId: string; paperIds?: string[]; papers: Paper[];
  retrieval?: { method: string; totalMatches: number; unmatchedPaperIds: string[] };
  verifyCode: boolean; verificationPlan: string; prompt: string; fullText?: boolean; passages?: { id: string; page: number; content: string }[];
};
export type Evidence = { paperId: string; quote: string; passageId?: string };
export type ReportSection = { heading: string; content: string; paperIds: string[]; evidence?: Evidence[] };
export type Experiment = {
  title: string; status: 'passed' | 'failed' | 'blocked' | 'not-run';
  files: { path: string; language: string; content: string }[]; commands: string[];
  paperIds: string[]; evidence?: Evidence[]; expected: string; observed: string; limitations: string;
};
export type Report = {
  id: string; createdAt?: string; intentId: string; title: string; sections?: ReportSection[];
  experiments?: Experiment[]; limitations?: string; acceptance: 'unverified';
  matrix?: { columns: { id: string; label: string }[]; cells: { paperId: string; columnId: string; value: string; status: 'supported' | 'missing' | 'conflict'; evidence: Evidence[] }[] };
};
export type Library = { papers: Paper[]; intents: Intent[]; reports: Report[]; matrixCount?: number; favorites?: SavedDiscovery[]; discoveries?: Pick<DiscoveryBatch, 'id' | 'seedId' | 'seedTitle' | 'relation' | 'page' | 'fetchedAt'>[] };
export type SearchItem = { id: string; source: string; title: string; url: string; authors?: string[]; abstract?: string };
export type EvidenceLocation = { start: number; end: number; heading?: string; before?: string; quote: string; after?: string; pdf?: { documentId: string; pages: number[]; rects?: PdfRect[] } };
export type PdfRect = { x: number; y: number; width: number; height: number };
export type PdfDocument = { id: string; paperId: string; fileDigest: string; sourceUrl: string; pages: { number: number; width: number; height: number; text: string }[]; createdAt: string };
export type PdfAnnotation = { id: string; documentId: string; paperId: string; page: number; kind: 'highlight' | 'figure'; rects: PdfRect[]; quote: string; note: string; createdAt: string };
export type PdfReading = { document: PdfDocument | null; annotations: PdfAnnotation[] };
export type PdfFocus = { documentId: string; page: number; annotationId?: string; rects?: PdfRect[] };
export type PdfSource = { documentId: string; page: number; fileDigest: string };
export type Api = { get<T>(path: string): Promise<T>; post<T>(path: string, body: unknown): Promise<T> };
export type Agent = {
  available: boolean; agents: { id: string; name: string; available: boolean }[]; workspace: string;
  refresh(): Promise<void>;
  start(input: { requestId: string; prompt: string; agentId: string }): Promise<{ sessionId: string }>;
  events(input: { sessionId: string; after: number }): Promise<{ events: unknown[]; cursor: number; status: string; text: string }>;
  cancel(input: { sessionId: string }): Promise<void>;
};
export type DiscoveryRelation = 'related' | 'references' | 'citing';
export type DiscoveryPaper = SearchItem & { authors: string[]; abstract: string; publicationDate: string; citations: number; doi: string };
export type DiscoveryBatch = { id: string; seedId: string; seedTitle: string; relation: DiscoveryRelation; work: DiscoveryPaper; items: DiscoveryPaper[]; page: number; hasMore: boolean; fetchedAt: string; matching: string };
export type SavedDiscovery = { id: string; batchId: string; seedId: string; seedTitle: string; relation: DiscoveryRelation; paper: DiscoveryPaper; fetchedAt: string };

export type LocalSearchHit = { id: string; content: string; start: number; end: number; heading: string; page: number | null; score: number;
  source: { id: string; paperId: string; title: string; url: string; contentKind: Paper['contentKind']; contentDigest: string; fileDigest: string | null; documentId: string | null; fetchedAt: string } };
export type LocalSearchResult = { items: LocalSearchHit[]; totalMatches: number; returned: number; truncated: boolean; queryTruncated: boolean };
