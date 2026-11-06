import type { SessionArtifact, SessionArtifactVersion } from '../../../protocol/generated/host';
import type { ArtifactBrowserState, ArtifactTarget, ArtifactView } from '../../../protocol/artifact-browser';

export type ArtifactPreviewTarget = ArtifactTarget;
export type ArtifactBrowserContext = ArtifactBrowserState;
export type ArtifactBrowserView = ArtifactView;

/** Admit the shell's catalog once; presentation code receives the shared typed state. */
export function admitArtifactBrowser(value: unknown, threadId: string): ArtifactBrowserContext {
  const record = (item: unknown): item is Record<string, unknown> =>
    typeof item === 'object' && item !== null && !Array.isArray(item);
  const identity = (item: unknown): item is string => typeof item === 'string' && item.length > 0;
  const integer = (item: unknown, minimum: number): item is number =>
    typeof item === 'number' && Number.isSafeInteger(item) && item >= minimum;
  const format = (item: unknown): boolean => record(item) && (
    (typeof item.kind === 'string' && ['text', 'markdown', 'json', 'json_lines'].includes(item.kind))
    || (item.kind === 'code' && typeof item.language === 'string')
  );
  const media = (item: unknown): boolean => record(item) && (
    (item.kind === 'document' && format(item.format))
    || (typeof item.kind === 'string' && ['csv', 'tsv', 'pdf', 'html', 'notebook'].includes(item.kind))
    || (item.kind === 'image' && typeof item.mime_type === 'string'
      && ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'].includes(item.mime_type))
  );

  if (!record(value) || !identity(threadId) || value.thread_id !== threadId
    || typeof value.view !== 'string' || !['icons', 'list', 'gallery'].includes(value.view) || !Array.isArray(value.artifacts)) {
    throw new Error('Invalid artifact browser state');
  }
  const ids = new Set<string>();
  for (const artifact of value.artifacts) {
    if (!record(artifact) || !identity(artifact.id) || ids.has(artifact.id)
      || artifact.thread_id !== threadId || typeof artifact.title !== 'string'
      || !Array.isArray(artifact.versions) || artifact.versions.length === 0) {
      throw new Error('Invalid artifact browser catalog');
    }
    ids.add(artifact.id);
    for (const version of artifact.versions) {
      if (!record(version) || !integer(version.version, 1) || !integer(version.bytes, 0)
        || typeof version.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(version.sha256)
        || !integer(version.created_at, 0) || !format(version.format)
        || (version.media !== undefined && !media(version.media))
        || (version.filename !== undefined && typeof version.filename !== 'string')
        || (version.source_message_id !== undefined && typeof version.source_message_id !== 'string')
        || (version.source_tool_call_id !== undefined && typeof version.source_tool_call_id !== 'string')
        || !record(version.source) || !(version.source.kind === 'text'
          || (version.source.kind === 'file' && identity(version.source.path)))) {
        throw new Error('Invalid artifact browser version');
      }
    }
  }
  if (value.selected !== null) {
    const selected = value.selected;
    if (!record(selected) || selected.thread_id !== threadId || !identity(selected.artifact_id)
      || !integer(selected.version, 1) || !value.artifacts.some(artifact =>
        artifact.id === selected.artifact_id && artifact.versions.some((version: SessionArtifactVersion) => version.version === selected.version))) {
      throw new Error('Invalid artifact browser selection');
    }
  }
  return value as ArtifactBrowserContext;
}

export function artifactVersion(artifact: SessionArtifact): SessionArtifactVersion {
  return artifact.versions[artifact.versions.length - 1];
}

/** Preserve this item's selected frozen version when changing presentation modes. */
export function artifactTarget(artifact: SessionArtifact, selected?: ArtifactPreviewTarget | null): ArtifactPreviewTarget {
  const version = selected?.thread_id === artifact.thread_id && selected.artifact_id === artifact.id
    ? artifact.versions.find(version => version.version === selected.version) : undefined;
  return { thread_id: artifact.thread_id, artifact_id: artifact.id, version: (version ?? artifactVersion(artifact)).version };
}

export function selectedArtifact(context: ArtifactBrowserContext): { artifact: SessionArtifact; version: SessionArtifactVersion } | undefined {
  const selected = context.selected;
  if (!selected) return undefined;
  const artifact = context.artifacts.find(artifact => artifact.id === selected.artifact_id);
  const version = artifact?.versions.find(version => version.version === selected.version);
  return artifact && version ? { artifact, version } : undefined;
}
