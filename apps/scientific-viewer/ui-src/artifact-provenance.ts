import { strToU8, zipSync } from 'fflate';
import type { ArtifactRelationRole, SessionArtifact, SessionArtifactVersion } from '../../../protocol/generated/host';
import { artifactSourceUrl, readArtifactSnapshot, type ArtifactSnapshot } from './artifact-source.ts';

export type ArtifactEvidence = Readonly<{ artifact: SessionArtifact; version: SessionArtifactVersion; role: ArtifactRelationRole }>;
export type ArtifactSelection = Readonly<{ artifact: SessionArtifact; version: SessionArtifactVersion }>;
export type RunEvidence = Readonly<{ path: string; role: ArtifactRelationRole; sha256: string; source_path?: string; executable?: boolean }>;
export type ArtifactProvenance = Readonly<{
  schema_version: 1 | 2; system: string; run_id: string;
  outcome: 'succeeded' | 'failed' | 'cancelled'; output_sha256: string; evidence: RunEvidence[];
  output_path?: string; output_kind?: 'run_report';
  invocation?: { command: string; args: string[]; cwd: string };
  execution?: { started_at: string; finished_at: string; exit_code: number | null; signal: string | null;
    spawn_error?: string; cancellation_requested?: boolean };
}>;
export type ArtifactEnvironmentObservation = Readonly<{ interpreter?: string; dependencies?: number; status: 'observed' | 'unobserved' | 'unavailable' }>;
const roles: ArtifactRelationRole[] = ['code', 'input', 'environment', 'execution_log', 'review'];
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && !value.includes('\0');
const workspacePath = (value: unknown): value is string => text(value) && !value.startsWith('/') && !value.includes('\\')
  && !/^[A-Za-z]:/.test(value) && value.split('/').every(part => part !== '..' && part !== '' && part !== '.');

/** The receipt is external data. Admit it once before presentation or export. */
export function admitArtifactProvenance(value: unknown, outputSha256: string): ArtifactProvenance {
  if (!record(value) || ![1, 2].includes(value.schema_version as number) || !text(value.system) || !text(value.run_id)
    || !['succeeded', 'failed', 'cancelled'].includes(value.outcome as string) || !digest(value.output_sha256)
    || value.output_sha256 !== outputSha256 || !Array.isArray(value.evidence) || value.evidence.length >= 16
    || value.evidence.some(item => !record(item) || !text(item.path) || !digest(item.sha256)
      || !roles.includes(item.role as ArtifactRelationRole) || (item.source_path !== undefined && !workspacePath(item.source_path))
      || (item.executable !== undefined && (typeof item.executable !== 'boolean' || item.role !== 'code' || !workspacePath(item.source_path))))) {
    throw new Error('The execution receipt does not match this artifact version');
  }
  if (value.schema_version === 2) {
    const invocation = value.invocation, execution = value.execution;
    if (!workspacePath(value.output_path) || (value.output_kind !== undefined && value.output_kind !== 'run_report')
      || !record(invocation) || !text(invocation.command) || invocation.cwd !== '.'
      || !Array.isArray(invocation.args) || invocation.args.some(arg => typeof arg !== 'string' || arg.includes('\0'))
      || !record(execution) || !text(execution.started_at) || !text(execution.finished_at)
      || !Number.isFinite(Date.parse(execution.started_at)) || !Number.isFinite(Date.parse(execution.finished_at))
      || Date.parse(execution.finished_at) < Date.parse(execution.started_at)
      || !(execution.exit_code === null || Number.isInteger(execution.exit_code))
      || !(execution.signal === null || text(execution.signal))
      || (execution.spawn_error !== undefined && !text(execution.spawn_error))
      || (execution.cancellation_requested !== undefined && typeof execution.cancellation_requested !== 'boolean')
      || value.evidence.some(item => !workspacePath(item.path))) throw new Error('The execution receipt has incomplete invocation details');
    const cancelled = Boolean(execution.signal || execution.cancellation_requested);
    const succeeded = execution.exit_code === 0 && !cancelled && !execution.spawn_error;
    if ((value.outcome === 'succeeded') !== succeeded || (value.outcome === 'cancelled') !== cancelled
      || (value.outcome === 'failed' && execution.exit_code === null && !execution.spawn_error)) {
      throw new Error('The execution outcome conflicts with its process observation');
    }
  } else if (value.invocation !== undefined || value.execution !== undefined || value.output_path !== undefined || value.output_kind !== undefined
    || value.evidence.some(item => item.source_path !== undefined || item.executable !== undefined)) {
    throw new Error('A legacy execution receipt cannot carry version 2 observations');
  }
  return value as ArtifactProvenance;
}

/** Resolve the exact relations on the selected historical version, never the latest. */
export function artifactEvidence(artifacts: readonly SessionArtifact[], selected: ArtifactSelection): ArtifactEvidence[] {
  return (selected.version.related ?? []).map(relation => {
    const artifact = artifacts.find(item => item.id === relation.artifact_id);
    const version = artifact?.versions.find(entry => entry.version === relation.version);
    if (!artifact || !version) throw new Error('A linked artifact version is unavailable');
    return { artifact, version, role: relation.role };
  });
}

export async function readEvidenceSnapshot(threadId: string, selected: ArtifactSelection, fetcher: typeof fetch = fetch): Promise<ArtifactSnapshot> {
  const locator = { threadId, artifactId: selected.artifact.id, version: selected.version.version };
  const snapshot = await readArtifactSnapshot(locator, await fetcher(artifactSourceUrl(locator)));
  if (snapshot.sha256 !== selected.version.sha256 || snapshot.bytes.length !== selected.version.bytes) {
    throw new Error('The retained bytes do not match the selected catalog version');
  }
  return snapshot;
}

export async function readArtifactProvenance(threadId: string, selected: ArtifactSelection, evidence: readonly ArtifactEvidence[], fetcher: typeof fetch = fetch) {
  const receipt = evidence.find(item => item.role === 'run_record');
  if (!receipt) return null;
  const snapshot = await readEvidenceSnapshot(threadId, receipt, fetcher);
  return admitArtifactProvenance(JSON.parse(new TextDecoder().decode(snapshot.bytes)), selected.version.sha256);
}

function environmentObservation(snapshot: ArtifactSnapshot | undefined): ArtifactEnvironmentObservation {
  if (!snapshot) return { status: 'unobserved' };
  let value: unknown;
  try { value = JSON.parse(new TextDecoder().decode(snapshot.bytes)); }
  catch { return { status: 'unobserved' }; } // Legacy environment attachments may be plain text.
  if (!record(value) || !record(value.python)) return { status: 'unobserved' };
  const python = value.python;
  if (python.status !== 'observed') return { status: python.status === 'unavailable' ? 'unavailable' : 'unobserved' };
  return { status: 'observed', ...(text(python.version) && text(python.executable) ? { interpreter: `Python ${python.version.split('\n')[0]} (${python.executable})` } : {}),
    ...(Array.isArray(python.packages) && python.packages.every(item => record(item) && text(item.name) && text(item.version)) ? { dependencies: python.packages.length } : {}) };
}

export async function readArtifactEnvironment(threadId: string, evidence: readonly ArtifactEvidence[], fetcher: typeof fetch = fetch) {
  const attached = evidence.find(item => item.role === 'environment');
  return environmentObservation(attached ? await readEvidenceSnapshot(threadId, attached, fetcher) : undefined);
}

export function provenanceGaps(provenance: ArtifactProvenance | null, evidence: readonly ArtifactEvidence[], environment?: ArtifactEnvironmentObservation): string[] {
  return [
    ...(!provenance ? ['execution receipt'] : !provenance.invocation ? ['command and arguments'] : []),
    ...(['code', 'input', 'environment', 'execution_log'] as const).filter(role => !evidence.some(file => file.role === role))
      .map(role => ({ code: 'code', input: 'input files', environment: 'environment observation', execution_log: 'execution log' })[role]),
    ...(evidence.some(file => file.role === 'environment') ? [
      ...(!environment?.interpreter ? ['interpreter observation'] : []),
      ...(environment?.dependencies === undefined ? ['dependency inventory'] : []),
    ] : []),
  ];
}

/** Export only retained bytes and observed facts. Running replay.mjs is an explicit local action. */
export async function exportArtifactReproduction(threadId: string, selected: ArtifactSelection, evidence: readonly ArtifactEvidence[], fetcher: typeof fetch = fetch) {
  const snapshots = await Promise.all([selected, ...evidence].map(item => readEvidenceSnapshot(threadId, item, fetcher)));
  const receiptIndex = evidence.findIndex(item => item.role === 'run_record');
  const provenance = receiptIndex < 0 ? null : admitArtifactProvenance(
    JSON.parse(new TextDecoder().decode(snapshots[receiptIndex + 1].bytes)), selected.version.sha256,
  );
  const files: Record<string, Uint8Array> = {};
  const outputPath = `snapshots/output/${encodeURIComponent(snapshots[0].name)}`;
  files[outputPath] = snapshots[0].bytes;
  const entries = evidence.map((item, index) => {
    const snapshot = snapshots[index + 1];
    const archivePath = `snapshots/evidence/${index}/${encodeURIComponent(snapshot.name)}`;
    files[archivePath] = snapshot.bytes;
    const observation = provenance?.evidence.find(observed => observed.role === item.role && observed.sha256 === snapshot.sha256
      && item.version.source.kind === 'file' && item.version.source.path.replaceAll('\\', '/').endsWith(`/${observed.path.replaceAll('\\', '/')}`));
    return { archive_path: archivePath, artifact_id: item.artifact.id, version: item.version.version,
      role: item.role, sha256: snapshot.sha256, ...(observation?.source_path ? { source_path: observation.source_path } : {}),
      ...(observation?.executable !== undefined ? { executable: observation.executable } : {}) };
  });
  if (provenance?.evidence.some(observed => !evidence.some(item => item.role === observed.role && item.version.sha256 === observed.sha256))) {
    throw new Error('The execution receipt references evidence that is not retained with this version');
  }
  const environmentIndex = evidence.findIndex(item => item.role === 'environment');
  const environment = environmentObservation(environmentIndex < 0 ? undefined : snapshots[environmentIndex + 1]);
  const replayable = provenance?.schema_version === 2 && provenance.output_kind !== 'run_report' && provenance.outcome !== 'cancelled';
  const manifest = { schema_version: 1, artifact_id: selected.artifact.id, version: selected.version.version,
    output: { archive_path: outputPath, sha256: snapshots[0].sha256, ...(provenance?.output_path ? { workspace_path: provenance.output_path } : {}) },
    provenance, files: entries, unavailable: provenanceGaps(provenance, evidence, environment) };
  files['reproduction.json'] = strToU8(JSON.stringify(manifest, null, 2) + '\n');
  files['README.txt'] = strToU8([
    `Pero retained artifact: ${selected.artifact.title} (version ${selected.version.version})`,
    `SHA-256: ${snapshots[0].sha256}`, `Observed execution: ${provenance?.outcome ?? 'not observed'}`,
    `Unavailable observations: ${manifest.unavailable.join(', ') || 'none among the listed receipt, code, input, environment, interpreter, dependency and log categories'}.`,
    '', 'These are retained bytes and process observations. They do not establish scientific acceptance.',
    'Environment observations describe the original interpreter and installed distributions; they are not an environment lock or an installation script.',
    'Inspect the code, command, arguments and environment observation before running anything.',
    replayable ? 'To rerun: in an environment providing Node.js and the observed command/dependencies, run: node replay.mjs'
      : provenance?.output_kind === 'run_report' ? 'This is a wrapper-generated run report. Its logs and invocation are retained; the child command cannot reproduce report timestamps or report bytes. Inspect the invocation to rerun the child manually.'
        : provenance?.outcome === 'cancelled' ? 'Automatic replay is unavailable for a cancelled run: its external cancellation timing was not captured as reproducible input. Inspect the invocation to rerun manually.'
        : 'Automatic replay is unavailable because this version has no complete command receipt.',
    'Replay creates a fresh replay-workspace directory, restores observed code/input files, executes the exact recorded command/arguments and checks the output digest.',
    'Unobserved files, system services and absolute argument paths must remain available separately. No dependencies are installed automatically.',
    'A failed/cancelled original run remains failed/cancelled in reproduction.json; rerunning cannot change that historical observation.',
  ].join('\n') + '\n');
  if (replayable) files['replay.mjs'] = strToU8(REPLAY_SCRIPT);
  return zipSync(files, { level: 6 });
}

const REPLAY_SCRIPT = `// Explicit local reproduction of observed code; inspect before running.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await readFile(resolve(root, 'reproduction.json'), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const workspace = resolve(root, 'replay-workspace');
const retained = new Map();
for (const file of [manifest.output, ...manifest.files]) {
  const bytes = await readFile(resolve(root, file.archive_path));
  if (hash(bytes) !== file.sha256) throw new Error('Retained file digest mismatch: ' + file.archive_path);
  retained.set(file.archive_path, bytes);
}
await mkdir(workspace); // A previous replay is never overwritten.
for (const file of manifest.files) {
  if (!file.source_path || !['code', 'input'].includes(file.role)) continue;
  const target = resolve(workspace, file.source_path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, retained.get(file.archive_path), { mode: file.role === 'code' && file.executable === true ? 0o755 : 0o644 });
}
const output = resolve(workspace, manifest.output.workspace_path);
await mkdir(dirname(output), { recursive: true });
const { command, args } = manifest.provenance.invocation;
console.log('Original observed outcome:', manifest.provenance.outcome);
console.log('Executing:', JSON.stringify([command, ...args]));
const result = spawnSync(command, args, { cwd: workspace, stdio: 'inherit' });
if (result.error) throw result.error;
console.log('Replay exit code:', result.status, 'signal:', result.signal);
const actual = hash(await readFile(output));
if (actual !== manifest.output.sha256) throw new Error('Replay output differs: ' + actual);
console.log('Output SHA-256 matches retained version:', actual);
process.exitCode = result.status ?? 1;
`;
