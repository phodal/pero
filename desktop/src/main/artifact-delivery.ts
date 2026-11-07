import { randomUUID } from 'node:crypto';
import { AppUseError } from './app-use-task.ts';
import type { ArtifactPresentation, ArtifactRelation, ArtifactSnapshot } from '../../../protocol/generated/host';

/** A file delivery request. The Host owns workspace admission and frozen bytes. */
export type ArtifactDeliveryInput = Readonly<{
  path: string;
  title?: string;
  artifact_id?: string;
  presentation?: ArtifactPresentation;
  related?: ArtifactRelation[];
}>;

export type ArtifactDeliveryPort = (
  thread: string,
  input: ArtifactDeliveryInput,
  signal: AbortSignal,
) => Promise<unknown>;

export const DELIVER_ARTIFACT_TOOL = {
  name: 'deliver_artifact',
  annotations: { readOnlyHint: false },
  description:
    "Save a generated file of at most 10 MiB from this conversation's workspace as a session artifact. Supported outputs include reports, scripts, JSON, CSV/TSV, images, PDF, HTML and saved notebooks. The Host freezes the file bytes; delivery does not execute code or verify a scientific result. Use a workspace-relative path or an absolute path inside this conversation's workspace. To update an existing item, pass its artifact_id. To link actual inputs, code, execution logs, environment or review documents, deliver those files first, then list their exact artifact_id, version and role in related. A review attachment does not indicate acceptance. If the user asks to display the output, request presentation 'side' or 'expanded'. Leave it unset for ordinary delivery. The request applies only while the calling conversation is visible; delivery does not confirm display. The Host binds the calling conversation.",
  inputSchema: {
    type: 'object',
    required: ['path'],
    additionalProperties: false,
    properties: {
      path: { type: 'string', minLength: 1 },
      title: { type: 'string' },
      artifact_id: { type: 'string' },
      presentation: { enum: ['side', 'expanded'] },
      related: { type: 'array', maxItems: 16, items: { type: 'object', additionalProperties: false,
        required: ['artifact_id', 'version', 'role'], properties: {
          artifact_id: { type: 'string', minLength: 1, maxLength: 128 },
          version: { type: 'integer', minimum: 1 },
          role: { enum: ['input', 'code', 'execution_log', 'environment', 'review'] },
        } } },
    },
  },
};

/** Parse the MCP boundary once; file paths and item ownership belong to Host. */
export function parseArtifactDelivery(value: unknown): ArtifactDeliveryInput {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AppUseError('ARTIFACT_DELIVERY_INVALID', 'Provide a file delivery object.');
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some(key => !['path', 'title', 'artifact_id', 'presentation', 'related'].includes(key)) ||
    typeof input.path !== 'string' || !input.path.length ||
    (input.title !== undefined && typeof input.title !== 'string') ||
    (input.artifact_id !== undefined && typeof input.artifact_id !== 'string') ||
    (input.presentation !== undefined && input.presentation !== 'side' && input.presentation !== 'expanded') ||
    (input.related !== undefined && (!Array.isArray(input.related) || input.related.length > 16 ||
      input.related.some(link => !link || typeof link !== 'object' ||
        Object.keys(link).some(key => !['artifact_id', 'version', 'role'].includes(key)) ||
        typeof link.artifact_id !== 'string' || !link.artifact_id || link.artifact_id.length > 128 ||
        !Number.isSafeInteger(link.version) || link.version < 1 ||
        !['input', 'code', 'execution_log', 'environment', 'review'].includes(link.role))))
  )
    throw new AppUseError('ARTIFACT_DELIVERY_INVALID', 'Use path, optional title, artifact_id, presentation and exact related versions; the Host binds the conversation.');
  return input as ArtifactDeliveryInput;
}

type ArtifactOperation = (ArtifactDeliveryInput & {
  action: 'register_file';
} | {
  action: 'resolve_snapshot';
  artifact_id: string;
  version: number;
});
type ArtifactCommand = ArtifactOperation & {
  method: 'artifacts';
  request_id: string;
  thread_id: string;
};

type ArtifactEvent = {
  kind: string;
  request_id?: string | null;
  thread_id?: string;
  text?: string;
  data?: unknown;
};

/** Correlates delivery commands with Host receipts; events still reach the UI. */
export class HostArtifactDelivery {
  private readonly send: (command: ArtifactCommand) => void;
  private readonly pending = new Map<string, {
    thread: string;
    response: 'artifact_registered' | 'artifact_snapshot_result';
    resolve(value: unknown): void;
    reject(error: unknown): void;
    dispose(): void;
  }>();
  private closed = false;

  constructor(send: (command: ArtifactCommand) => void) {
    this.send = send;
  }

  readonly deliver: ArtifactDeliveryPort = (thread, input, signal) =>
    this.request(thread, { ...input, action: 'register_file' }, 'artifact_registered', signal);

  readonly resolveSnapshot = (thread: string, artifact: string, version: number, signal: AbortSignal): Promise<ArtifactSnapshot> =>
    this.request(thread, { action: 'resolve_snapshot', artifact_id: artifact, version }, 'artifact_snapshot_result', signal) as Promise<ArtifactSnapshot>;

  private async request(
    thread: string,
    command: ArtifactOperation,
    response: 'artifact_registered' | 'artifact_snapshot_result',
    signal: AbortSignal,
  ): Promise<unknown> {
    signal.throwIfAborted();
    if (this.closed) throw new Error('Artifact delivery connection closed');
    const request_id = randomUUID();
    return new Promise((resolve, reject) => {
      const abort = () => this.finish(request_id, signal.reason || new Error('Artifact delivery cancelled'));
      this.pending.set(request_id, {
        thread, response, resolve, reject,
        dispose: () => signal.removeEventListener('abort', abort),
      });
      signal.addEventListener('abort', abort, { once: true });
      try {
        this.send({ ...command, method: 'artifacts', request_id, thread_id: thread });
      } catch (error) {
        this.finish(request_id, error);
      }
    });
  }

  accept(event: ArtifactEvent) {
    const privateSnapshot = event.kind === 'artifact_snapshot_result';
    const request = event.request_id && this.pending.get(event.request_id);
    if (!request || request.thread !== event.thread_id) return privateSnapshot;
    if (event.kind === request.response) {
      if (privateSnapshot) {
        const result = event.data as { ok: boolean; value?: ArtifactSnapshot; error?: string };
        this.finish(event.request_id!, result.ok ? undefined : new Error(result.error || 'Artifact snapshot unavailable'), result.value);
      } else this.finish(event.request_id!, undefined, event.data);
    }
    if (event.kind === 'artifact_error') this.finish(event.request_id!, new Error(event.text || 'Artifact delivery failed'));
    return privateSnapshot; // Private Host paths never reach a renderer, even for late receipts.
  }

  close() {
    this.closed = true;
    for (const request of this.pending.keys()) this.finish(request, new Error('Artifact delivery connection closed'));
  }

  private finish(request: string, error?: unknown, value?: unknown) {
    const pending = this.pending.get(request);
    if (!pending) return;
    this.pending.delete(request);
    pending.dispose();
    if (error !== undefined) pending.reject(error);
    else pending.resolve(value);
  }
}
