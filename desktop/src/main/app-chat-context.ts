import { createHash, randomUUID } from 'node:crypto';
import type { AppUsePorts } from './app-use.ts';
import { AppUseError, type AppScope, type AppSurface } from './app-use-task.ts';
import type { ContextReference } from '../../../protocol/generated/host';
import { parseAppChatLaunch } from '../../../packages/app-sdk/src/app-chat.ts';
import type { AppObjectSnapshot } from '../../../packages/app-sdk/src/app-use.ts';

/** A frozen App context is owned by the draft selected before an asynchronous capture. */
export class AppChatContext {
  private ports: AppUsePorts;
  constructor(ports: AppUsePorts) {
    this.ports = ports;
  }
  async freeze(scope: AppScope, thread: string, options: unknown): Promise<ContextReference[]> {
    if (
      !scope ||
      typeof scope.app !== 'string' ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(scope.app) ||
      typeof scope.panel !== 'string' ||
      !/^[a-z][a-z0-9_-]{0,63}$/.test(scope.panel) ||
      typeof thread !== 'string' ||
      !thread ||
      thread.length > 256
    )
      throw new AppUseError('APP_CONTEXT_INVALID', 'Choose an App panel and destination draft.');
    const input = parseAppChatLaunch(options);
    if ((await this.ports.selectedThread()) !== thread)
      throw new AppUseError('APP_DRAFT_CHANGED', 'Select the destination draft before adding App context.');
    const status = (await this.ports.page(scope, { action: 'status' })) as AppSurface;
    const capturedAt = new Date(this.ports.now?.() ?? Date.now()).toISOString();
    const contexts: ContextReference[] = [];
    for (const ref of input.attachments || []) {
      const snapshot = (await this.ports.page(scope, {
        action: 'semantic',
        instance: status.instance,
        target: ref.objectId,
      })) as { objects: AppObjectSnapshot[] };
      const object = snapshot.objects.find((object) => object.id === ref.objectId);
      if (!object || object.revision !== ref.revision)
        throw new AppUseError(
          'APP_REVISION_STALE',
          'The App object changed. Select its current reference and try again.',
        );
      const text = JSON.stringify({
        schema: 'pero.app-object.v1',
        scope,
        instance: status.instance,
        objectId: object.id,
        revision: object.revision,
        kind: object.kind,
        label: object.label,
        state: object.state,
        selection: ref.selection ?? null,
        capturedAt,
      });
      contexts.push({
        id: `app-object-${randomUUID()}`,
        kind: 'app_object',
        label: `${object.label} · r${object.revision} · ${scope.app}`,
        source: `pero-app://${scope.app}/#${encodeURIComponent(object.id)}@${object.revision}`,
        content: { type: 'text', text },
      });
    }
    if (input.capture) {
      if ((await this.ports.selectedThread()) !== thread)
        throw new AppUseError('APP_DRAFT_CHANGED', 'The destination conversation changed before capture.');
      const before = (await this.ports.page(scope, { action: 'annotation', instance: status.instance })) as {
        rect: AppSurface['rect'];
        [key: string]: unknown;
      };
      const visible = (await this.ports.page(scope, {
        action: 'status',
        instance: status.instance,
      })) as AppSurface;
      if (!(visible.capturable ?? visible.operable))
        throw new AppUseError('APP_SURFACE_HIDDEN', 'Show the App panel before taking its snapshot.');
      const capturedAt = new Date(this.ports.now?.() ?? Date.now()).toISOString();
      const id = randomUUID(),
        image = await this.ports.capture(before.rect, id);
      const after = await this.ports.page(scope, { action: 'annotation', instance: status.instance });
      if (JSON.stringify(before) !== JSON.stringify(after))
        throw new AppUseError(
          'APP_CAPTURE_CHANGED',
          'The App changed during capture. Capture its current state again.',
        );
      const receipt = {
        schema: 'pero.app-capture.v1' as const,
        id,
        role: 'app-capture' as const,
        mediaType: 'image/png' as const,
        sha256: createHash('sha256').update(image.png).digest('hex'),
        bytes: image.png.length,
        width: image.width,
        height: image.height,
        scope,
        surfaceId: status.surfaceId,
        instance: status.instance,
        rect: before.rect,
        threadId: thread,
        agentId: 'user-context',
        taskId: `draft:${thread}`,
        capturedAt,
        path: image.path,
      };
      await this.ports.recordEvidence?.(receipt);
      contexts.push({
        id: `app-snapshot-${id}`,
        kind: 'image',
        label: `${scope.app} · ${capturedAt}`,
        source: `pero-evidence:${id}`,
        content: { type: 'image', data: image.png.toString('base64'), mime_type: 'image/png' },
      });
      contexts.push({
        id: `app-annotation-${id}`,
        kind: 'app_object',
        label: `${scope.app} · snapshot context`,
        source: `pero-evidence:${id}`,
        content: {
          type: 'text',
          text: JSON.stringify({ schema: 'pero.app-annotation.v1', evidence: receipt, snapshot: before }),
        },
      });
    }
    const text = contexts.reduce(
      (size, ref) => size + (ref.content.type === 'text' ? Buffer.byteLength(ref.content.text) : 0),
      0,
    );
    const images = contexts.reduce(
      (size, ref) => size + (ref.content.type === 'image' ? ref.content.data.length : 0),
      0,
    );
    if (text > 128000 || images > 14000000)
      throw new AppUseError(
        'APP_CONTEXT_LIMIT',
        'App context exceeds the current draft budget. Choose fewer objects.',
      );
    return contexts;
  }
}
