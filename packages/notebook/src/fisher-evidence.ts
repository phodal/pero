import type { ScientificReference } from './document.ts';

export const maxFisherReceiptBytes = 4096;
const schema = 'pero.fisher-notebook-evidence.v1';
const digestPattern = /^[a-f0-9]{64}$/;
const attemptPattern = /^[a-f0-9]{32}$/;
const idFields = ['itemId', 'paperId', 'documentId', 'annotationId', 'fileDigest', 'observationsDigest'] as const;
const fields = ['kind', ...idFields, 'attemptId', 'page', 'exactNumerator', 'exactDenominator', 'resultVerdict', 'numericRecomputation', 'paperVerdict'] as const;

export interface FisherEvidenceSnapshot {
  kind: 'fisher-attempt';
  itemId: string;
  attemptId: string;
  paperId: string;
  documentId: string;
  annotationId: string;
  page: 4;
  fileDigest: string;
  observationsDigest: string;
  exactNumerator: number;
  exactDenominator: number;
  resultVerdict: 'REPRODUCED' | 'MISMATCH';
  numericRecomputation: 'PASS';
  paperVerdict: 'NOT_ASSESSED';
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function identifier(value: unknown, pattern: RegExp, length: number): value is string {
  return typeof value === 'string' && value.length === length && pattern.test(value);
}

function positive(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function isFisherEvidenceSnapshot(value: unknown): value is FisherEvidenceSnapshot {
  return record(value) && Object.keys(value).length === fields.length && value.kind === 'fisher-attempt' &&
    idFields.every(key => identifier(value[key], digestPattern, 64)) &&
    identifier(value.attemptId, attemptPattern, 32) && value.page === 4 &&
    positive(value.exactNumerator) && positive(value.exactDenominator) &&
    (value.resultVerdict === 'REPRODUCED' || value.resultVerdict === 'MISMATCH') &&
    value.numericRecomputation === 'PASS' && value.paperVerdict === 'NOT_ASSESSED';
}

export function fisherEvidenceReference(snapshot: FisherEvidenceSnapshot, digest: string): ScientificReference {
  return { app: 'paper-agent', kind: 'fisher-attempt', id: snapshot.itemId, version: digest,
    locator: `pero-app-location://paper-agent/main/fisher/${snapshot.itemId}/attempt/${snapshot.attemptId}/receipt/${digest}` };
}

export function isFisherEvidenceReference(source: ScientificReference, snapshot?: FisherEvidenceSnapshot): boolean {
  if (source.app !== 'paper-agent' || source.kind !== 'fisher-attempt' ||
      !identifier(source.id, digestPattern, 64) || !identifier(source.version, digestPattern, 64)) return false;
  const match = /^pero-app-location:\/\/paper-agent\/main\/fisher\/([a-f0-9]{64})\/attempt\/([a-f0-9]{32})\/receipt\/([a-f0-9]{64})$/.exec(source.locator);
  return match !== null && match[0] === source.locator && match[1] === source.id && match[3] === source.version &&
    (!snapshot || (match[1] === snapshot.itemId && match[2] === snapshot.attemptId));
}

// A matching digest checks the imported snapshot's integrity, not who created it.
export async function readFisherEvidence(bytes: ArrayBuffer): Promise<{ reference: ScientificReference; snapshot: FisherEvidenceSnapshot }> {
  if (bytes.byteLength === 0 || bytes.byteLength > maxFisherReceiptBytes) throw new Error('Choose a nonempty Fisher evidence JSON receipt up to 4 KiB.');
  const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!record(value) || Object.keys(value).length !== 3 || value.schema !== schema ||
      !identifier(value.id, digestPattern, 64) || !isFisherEvidenceSnapshot(value.snapshot)) {
    throw new Error('Invalid Fisher evidence receipt.');
  }
  const snapshot = value.snapshot;
  const canonical = JSON.stringify(Object.fromEntries([...fields].sort().map(key => [key, snapshot[key]])));
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  const digest = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  if (digest !== value.id) throw new Error('Fisher evidence snapshot does not match its receipt digest.');
  return { reference: fisherEvidenceReference(snapshot, digest), snapshot };
}
