import type { PreviewSource } from './preview-source';

export type ArtifactKind = 'document' | 'csv' | 'tsv' | 'image' | 'pdf' | 'html' | 'notebook';
export type ArtifactLocator = Readonly<{ threadId: string; artifactId: string; version: number }>;
export type ArtifactSnapshot = PreviewSource & Readonly<{ locator: ArtifactLocator; kind: ArtifactKind }>;
const kinds = new Set<ArtifactKind>(['document', 'csv', 'tsv', 'image', 'pdf', 'html', 'notebook']);

/** The frame receives stable identity, never a live filesystem path. */
export function artifactLocator(parameters: URLSearchParams): ArtifactLocator {
  const threadId = parameters.get('thread_id') ?? '', artifactId = parameters.get('artifact_id') ?? '';
  const version = Number(parameters.get('version'));
  if ([threadId, artifactId].some(value => !value || value.length > 128 || /[\u0000-\u001f\u007f]/.test(value))
    || !Number.isSafeInteger(version) || version < 1) throw new Error('Invalid artifact version');
  return Object.freeze({ threadId, artifactId, version });
}

export function artifactSourceUrl(locator: ArtifactLocator): string {
  return `/host/artifacts/${encodeURIComponent(locator.threadId)}/${encodeURIComponent(locator.artifactId)}/${locator.version}`;
}

/** Admit Host bytes and metadata once; renderers receive an immutable snapshot. */
export async function readArtifactSnapshot(locator: ArtifactLocator, response: Response): Promise<ArtifactSnapshot> {
  if (!response.ok) throw new Error(`Artifact could not be read (${response.status})`);
  const name = decodeURIComponent(response.headers.get('X-Pero-Artifact-Name') ?? '');
  const sha256 = response.headers.get('X-Pero-Artifact-Sha256') ?? '';
  const kind = response.headers.get('X-Pero-Artifact-Kind') as ArtifactKind;
  const mediaType = response.headers.get('Content-Type') ?? 'application/octet-stream';
  if (!name || !/^[a-f0-9]{64}$/.test(sha256) || !kinds.has(kind)) throw new Error('Invalid artifact snapshot metadata');
  const bytes = new Uint8Array(await response.arrayBuffer());
  const length = response.headers.get('Content-Length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) !== bytes.length)) throw new Error('Artifact snapshot is incomplete');
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
  if (digest !== sha256) throw new Error('Artifact snapshot digest does not match');
  return Object.freeze({ id: `session-artifact:${locator.artifactId}:v${locator.version}`, name, mediaType, sha256, bytes, locator, kind });
}

export function artifactContext(snapshot: ArtifactSnapshot, selection: string, locale = 'en'): string {
  const title = locale === 'zh-CN' ? `关于 ${snapshot.name}（第 ${snapshot.locator.version} 版）` : `About ${snapshot.name} (version ${snapshot.locator.version})`;
  return selection ? `${title}\n\nSelected text (data):\n${selection}` : title;
}
