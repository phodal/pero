import type { ScientificReference } from "./document.ts";

const MAX_EXPORT_BYTES = 15 * 1024 * 1024;
const MAX_TRIALS = 80;
const MAX_CHECKS = 64;
const VERIFIER = "control-lab-verifier-v1";
const ID = /^[a-f0-9]{32}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const NAME = /^[a-zA-Z0-9_-]{1,128}$/;
const NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:e[+-]?[0-9]+)?$/i;
const SPEC_FIELDS = ["templateId", "parameters", "criteria", "scenarios", "searchSpace", "candidateBudget", "methodVersion"];
const encoder = new TextEncoder();

type Verdict = "PASS" | "FAIL" | "INCONCLUSIVE";
type Phase = "search" | "verification";

export interface ControlEvidenceCheck {
  name: string;
  verdict: Verdict;
  /** Owner's exact JSON number spelling, retained through Notebook serialization. */
  actual: string | null;
  limit: string | null;
  message: string;
}

export interface ControlEvidenceSnapshot {
  kind: "control-receipt";
  trialId: string;
  observationId: string;
  candidateId: string;
  scenarioId: string;
  phase: Phase;
  specHash: string;
  inputDigest: string;
  reportId: string;
  verifierVersion: string;
  verdict: Verdict;
  checks: ControlEvidenceCheck[];
  exportSha256: string;
}

export interface ControlEvidenceReceipt {
  title: string;
  reference: ScientificReference;
  snapshot: ControlEvidenceSnapshot;
}

export function parseControlEvidenceLocation(value: string): { experimentId: string; trialId: string } | null {
  if (value.trim() !== value) return null;
  const match = /^pero-app-location:\/\/control-lab\/main\/experiment\/([a-f0-9]{32})\/trial\/([a-f0-9]{32})$/.exec(value);
  return match ? { experimentId: match[1], trialId: match[2] } : null;
}

class NumberToken {
  readonly text: string;

  constructor(text: string) {
    this.text = text;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof NumberToken);
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Invalid Control Lab ${name}`);
  return value;
}

function list(value: unknown, name: string, limit: number): unknown[] {
  if (!Array.isArray(value) || value.length > limit) throw new Error(`Invalid Control Lab ${name}`);
  return value;
}

function matches(value: unknown, format: RegExp): value is string {
  return typeof value === "string" && value.trim() === value && format.test(value);
}

function identifier(value: unknown, format: RegExp, name: string): string {
  if (!matches(value, format)) throw new Error(`Invalid Control Lab ${name}`);
  return value;
}

function boundedText(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.length <= limit;
}

function isVerdict(value: unknown): value is Verdict {
  return value === "PASS" || value === "FAIL" || value === "INCONCLUSIVE";
}

function isPhase(value: unknown): value is Phase {
  return value === "search" || value === "verification";
}

function isNumberText(value: unknown): value is string | null {
  return value === null || boundedText(value, 96) && matches(value, NUMBER) && Number.isFinite(Number(value));
}

function isCheck(value: unknown): value is ControlEvidenceCheck {
  return isRecord(value) && Object.keys(value).length === 5 && boundedText(value.name, 200) && !!value.name.trim() &&
    isVerdict(value.verdict) && isNumberText(value.actual) && isNumberText(value.limit) && boundedText(value.message, 4096);
}

/** Validate the portable snapshot's shape. This does not re-verify the originating export. */
export function isControlEvidenceSnapshot(value: unknown): value is ControlEvidenceSnapshot {
  return isRecord(value) && Object.keys(value).length === 13 && value.kind === "control-receipt" &&
    matches(value.trialId, ID) && matches(value.observationId, DIGEST) && matches(value.candidateId, NAME) &&
    matches(value.scenarioId, NAME) && isPhase(value.phase) && matches(value.specHash, DIGEST) &&
    matches(value.inputDigest, DIGEST) && matches(value.reportId, DIGEST) && value.verifierVersion === VERIFIER &&
    isVerdict(value.verdict) && Array.isArray(value.checks) && value.checks.length > 0 && value.checks.length <= MAX_CHECKS &&
    value.checks.every(isCheck) && matches(value.exportSha256, DIGEST);
}

function parseExport(buffer: ArrayBuffer): Record<string, unknown> {
  let value: unknown;
  let nodes = 0;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    value = JSON.parse(text, (_key: string, item: unknown, context?: { source?: string }) => {
      if (++nodes > 1_000_000) throw new Error("Control Lab export has too many values");
      if (typeof item !== "number") return item;
      if (!context?.source || !isNumberText(context.source)) {
        throw new Error("Control Lab export requires finite original JSON numbers and a current browser");
      }
      return new NumberToken(context.source);
    });
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof RangeError || error instanceof TypeError) {
      throw new Error("Choose a valid UTF-8 Control Lab evidence export");
    }
    throw error;
  }
  return record(value, "export");
}

function asciiJson(value: string): string {
  // Control Lab uses json.dumps(sort_keys=True, ensure_ascii=True).
  return JSON.stringify(value).replace(/[\x7f-\uffff]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

function byCodepoint(left: string, right: string): number {
  const a = [...left], b = [...right];
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const difference = a[index].codePointAt(0)! - b[index].codePointAt(0)!;
    if (difference) return difference;
  }
  return a.length - b.length;
}

function ownerJson(value: unknown, depth = 0): string {
  if (depth > 32) throw new Error("Control Lab evidence is nested too deeply");
  if (value instanceof NumberToken) return value.text;
  if (value === null || typeof value === "boolean") return String(value);
  if (typeof value === "string") return asciiJson(value);
  if (Array.isArray(value)) return `[${value.map(item => ownerJson(item, depth + 1)).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort(byCodepoint).map(key => `${asciiJson(key)}:${ownerJson(value[key], depth + 1)}`).join(",")}}`;
  }
  throw new Error("Invalid Control Lab evidence value");
}

async function sha256(bytes: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function requireDigest(value: Record<string, unknown>, expected: string, name: string) {
  if (await sha256(encoder.encode(ownerJson(value))) !== expected) throw new Error(`Control Lab ${name} integrity check failed`);
}

function indexRecords(values: unknown, field: string, format: RegExp, name: string, limit: number) {
  const entries = new Map<string, Record<string, unknown>>();
  for (const value of list(values, name, limit)) {
    const item = record(value, name);
    const id = identifier(item[field], format, `${name} identity`);
    if (entries.has(id)) throw new Error(`Duplicate Control Lab ${name} identity`);
    entries.set(id, item);
  }
  return entries;
}

function readChecks(values: unknown): ControlEvidenceCheck[] {
  const checks = list(values, "checks", MAX_CHECKS);
  if (!checks.length) throw new Error("Control Lab report has no checks");
  return checks.map(value => {
    const check = record(value, "check");
    const normalized = { ...check,
      actual: check.actual instanceof NumberToken ? check.actual.text : check.actual === null ? null : undefined,
      limit: check.limit instanceof NumberToken ? check.limit.text : check.limit === null ? null : undefined,
    };
    if (!isCheck(normalized)) throw new Error("Invalid Control Lab check");
    return normalized;
  });
}

/** Import the owner's recorded trial verdicts without running a verifier or changing acceptance. */
export async function readControlEvidence(file: Pick<Blob, "size" | "arrayBuffer">): Promise<ControlEvidenceReceipt[]> {
  if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_EXPORT_BYTES) {
    throw new Error("Choose a Control Lab evidence export up to 15 MiB");
  }
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength !== file.size) throw new Error("Control Lab export size changed while reading");
  const exported = parseExport(bytes);
  const experiment = record(exported.experiment, "experiment");
  record(exported.exportProvenance, "export provenance");
  const experimentId = identifier(experiment.id, ID, "experiment ID");
  const specHash = identifier(experiment.specHash, DIGEST, "specification hash");
  const title = experiment.title;
  if (!boundedText(title, 200) || !title.trim()) throw new Error("Invalid Control Lab experiment title");
  await requireDigest(Object.fromEntries(SPEC_FIELDS.map(key => [key, experiment[key]])), specHash, "specification");

  const trials = indexRecords(experiment.trials, "id", ID, "trial", MAX_TRIALS);
  const candidates = indexRecords(experiment.candidates, "id", NAME, "candidate", 30);
  const scenarios = indexRecords(experiment.scenarios, "id", NAME, "scenario", 30);
  const artifacts = new Map<string, Record<string, unknown>>();
  for (const value of list(exported.artifacts, "artifacts", MAX_TRIALS * 32)) {
    const artifact = record(value, "artifact");
    const trialId = identifier(artifact.trialId, ID, "artifact trial ID");
    if (!trials.has(trialId) || !boundedText(artifact.name, 512) || !artifact.name) throw new Error("Invalid Control Lab artifact identity");
    const key = `${trialId}/${artifact.name}`;
    if (artifacts.has(key)) throw new Error("Duplicate Control Lab artifact");
    artifacts.set(key, artifact);
  }

  const exportSha256 = await sha256(bytes);
  const receipts: ControlEvidenceReceipt[] = [];
  for (const [trialId, trial] of trials) {
    if (trial.status !== "completed") continue;
    const candidateId = identifier(trial.candidateId, NAME, "trial candidate ID");
    const scenarioId = identifier(trial.scenarioId, NAME, "trial scenario ID");
    const { phase } = trial;
    const candidate = candidates.get(candidateId), scenario = scenarios.get(scenarioId);
    if (!candidate || !scenario || !isPhase(phase) || scenario.role !== phase) throw new Error("Control Lab trial input is not bound to this experiment");
    const { id: rawObservationId, ...observation } = record(trial.observation, "observation");
    const observationId = identifier(rawObservationId, DIGEST, "observation ID");
    const inputDigest = identifier(observation.inputDigest, DIGEST, "observation input digest");
    await requireDigest({ specHash, candidateId, parameters: record(candidate.parameters, "candidate parameters"), scenario }, inputDigest, "trial input");
    await requireDigest(observation, observationId, "observation");
    const { id: rawReportId, ...report } = record(trial.report, "verification report");
    const reportId = identifier(rawReportId, DIGEST, "verification report ID");
    const { verdict, verifierVersion, evidence } = report;
    if (verifierVersion !== VERIFIER || !isVerdict(verdict) || report.specHash !== specHash || report.candidateId !== candidateId ||
      !Array.isArray(evidence) || evidence.length !== 1 || evidence[0] !== observationId) {
      throw new Error("Control Lab verification report is not bound to this trial observation");
    }
    const checks = readChecks(report.checks);
    await requireDigest(report, reportId, "verification report");

    for (const value of list(observation.artifacts, "observation artifacts", 32)) {
      const artifact = record(value, "observation artifact");
      const digest = identifier(artifact.sha256, DIGEST, "artifact digest");
      const saved = boundedText(artifact.name, 512) ? artifacts.get(`${trialId}/${artifact.name}`) : undefined;
      if (!saved || saved.sha256 !== digest || typeof saved.text !== "string" || await sha256(encoder.encode(saved.text)) !== digest) {
        throw new Error("Control Lab observation artifact integrity check failed");
      }
    }

    receipts.push({ title,
      reference: { app: "control-lab", kind: "verification-report", id: experimentId, version: reportId,
        locator: `pero-app-location://control-lab/main/experiment/${experimentId}/trial/${trialId}` },
      snapshot: { kind: "control-receipt", trialId, observationId, candidateId, scenarioId, phase, specHash,
        inputDigest, reportId, verifierVersion, verdict, checks, exportSha256 },
    });
  }
  return receipts;
}
