export type Paper = {
  id: string; resourceKind?: 'web_article' | 'paper'; limitation?: string; source: string; sourceId: string; title: string; authors: string[];
  url: string; metadataUrl?: string; fullTextUrl?: string; pdfUrl?: string; pdfCandidateUrl?: string; arxivUrl?: string; hasCachedPdf?: boolean; contentKind: 'abstract' | 'report' | 'full-text';
  contentDigest: string; fetchedAt: string; content?: string;
  hasSavedText?: boolean; hasSearchablePdf?: boolean;
};
export type Intent = {
  id: string; createdAt?: string; question: string; requestId: string; paperIds?: string[]; papers: Paper[];
  retrieval?: { method: string; totalMatches: number; unmatchedPaperIds: string[]; gaps?: string[] };
  contextFile?: { paperId: string; anchor?: PdfFocus };
  parentIntentId?: string; conversation?: { intentId: string; question: string; answer: string }[];
  verifyCode: boolean; verificationPlan: string; prompt: string; fullText?: boolean; passages?: { id: string; paperId: string; page: number; content: string }[];
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
export type StudyFinding = { text: string; evidence?: Evidence[] };
export type StudySummary = {
  id: string; requestId: string; question: string; createdAt: string; paperIds: string[];
  intentId: string | null; reportId: string | null;
  budget: { limit: number; used: number; remaining: number };
};
export type ResearchStudy = StudySummary & {
  prompt: string;
  findings: StudyFinding[]; gaps: string[];
  steps: { action: 'search' | 'read' | 'note' | 'finalize'; paperId?: string; page?: number; query?: string }[];
  passages: { id: string; paperId: string; page: number; content: string }[];
};
export type Library = { bundles?: import('./research-types').ResearchBundle[]; papers: Paper[]; intents: Intent[]; reports: Report[]; studies?: StudySummary[]; matrixCount?: number; favorites?: SavedDiscovery[]; discoveries?: Pick<DiscoveryBatch, 'id' | 'seedId' | 'seedTitle' | 'relation' | 'page' | 'fetchedAt'>[] };
export type SearchItem = { id: string; source: string; title: string; url?: string | null; authors?: string[]; abstract?: string;
  publicationDate?: string | null; citations?: number | null; citationSource?: string; doi?: string; pdfUrl?: string; fullTextUrl?: string;
  paperUrl?: string; hfVotes?: number; thumbnailUrl?: string; thumbnailId?: string; githubUrl?: string; githubStars?: number; projectUrl?: string;
  alternatives?: { source: string; id: string; url: string | null }[] };
export type EvidenceLocation = { start: number; end: number; heading?: string; before?: string; quote: string; after?: string; pdf?: { documentId: string; pages: number[]; verification?: string; candidates?: PdfFocus[]; candidateCount?: number; rects?: PdfRect[] } };
export type PdfRect = { x: number; y: number; width: number; height: number };
export type PdfDocument = { id: string; paperId: string; fileDigest: string; sourceUrl: string; pages: { number: number; width: number; height: number; text: string }[]; createdAt: string };
export type PdfAnnotation = { id: string; documentId: string; paperId: string; page: number; kind: 'highlight' | 'figure'; rects: PdfRect[]; quote: string; note: string; createdAt: string };
export type PdfReading = { document: PdfDocument | null; annotations: PdfAnnotation[]; originalUrl?: string | null };
export type PdfFocus = { documentId: string; page: number; annotationId?: string; rects?: PdfRect[]; verification?: { itemId: string; attemptId: string } };
export type TextFocus = { start: number; end: number; token: number };
export type PdfSource = { documentId: string; page: number; fileDigest: string; rects?: PdfRect[]; paperId?: string; texPreviewId?: string };
export type ReaderLocation = { representation: 'read' | 'original'; paperId: string } | (PdfSource & {
  representation: 'pdf' | 'tex-preview'; paperId: string; excerpt: string;
});
export type SourceFocus = { memberId: string; line: number };
export type Api = { get<T>(path: string): Promise<T>; post<T>(path: string, body: unknown): Promise<T> };
export type DiscoveryRelation = 'related' | 'references' | 'citing';
export type DiscoveryPaper = SearchItem & { url: string; authors: string[]; abstract: string; publicationDate: string | null; citations: number | null; doi: string };
export type DiscoveryBatch = { id: string; seedId: string; seedTitle: string; relation: DiscoveryRelation; work: DiscoveryPaper; items: DiscoveryPaper[]; page: number; hasMore: boolean; fetchedAt: string; matching: string };
export type SavedDiscovery = { id: string; batchId: string; seedId: string; seedTitle: string; relation: DiscoveryRelation; paper: DiscoveryPaper; fetchedAt: string };

export type LocalSearchHit = { id: string; content: string; start: number; end: number; heading: string; page: number | null; score: number;
  source: { id: string; paperId: string; title: string; url: string; contentKind: Paper['contentKind']; contentDigest: string; fileDigest: string | null; documentId: string | null; fetchedAt: string } };
export type LocalSearchResult = { items: LocalSearchHit[]; totalMatches: number; returned: number; truncated: boolean; queryTruncated: boolean; queryTerms?: string[] };

/** Frozen App selection passed into the Host draft; it grants no execution permission. */
export type PaperResearchSelection = { paperIds: string[]; fullText: boolean; contextId?: string; parentIntentId?: string; studyId?: string };
