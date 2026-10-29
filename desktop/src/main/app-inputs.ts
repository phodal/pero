import { createHash, randomBytes } from 'node:crypto';
import type { ContextReference } from '../../../protocol/generated/host';
import { AppParameterSchema, type AppJson } from '../../../packages/app-sdk/src/app-use.ts';
import type { AppUseTask } from './app-use-task.ts';
import { AppUseError } from './app-use-task.ts';

type FrozenFile = Readonly<{ ref: string; name: string; mediaType: string; data: Buffer }>;
type InputGrant = Readonly<{
  file: FrozenFile;
  taskId: string;
  threadId: string;
  app: string;
  panel: string;
  expiresAt: number;
}>;
/** Only files explicitly selected in a conversation can become App input grants. */
export class AppInputs {
  private files = new Map<string, Map<string, FrozenFile>>();
  private grants = new Map<string, InputGrant>();
  retain(thread: string, references: readonly ContextReference[]) {
    const catalog = this.files.get(thread) || new Map<string, FrozenFile>();
    for (const reference of references) {
      if (reference.kind !== 'file' && reference.kind !== 'image') continue;
      const data =
        reference.content.type === 'text'
          ? Buffer.from(reference.content.text, 'utf8')
          : Buffer.from(reference.content.data, 'base64');
      const ref = `sha256:${createHash('sha256').update(data).digest('hex')}`;
      const basename = reference.label
        .split(/[\\/]/)
        .at(-1)!
        .replace(/["\r\n]/g, '_');
      const name = [...basename].slice(0, 160).join('') || 'attachment';
      catalog.set(ref, {
        ref,
        name,
        data,
        mediaType:
          reference.content.type === 'image' ? reference.content.mime_type : 'text/plain;charset=utf-8',
      });
    }
    this.files.set(thread, catalog);
  }
  catalog(thread: string) {
    return [...(this.files.get(thread)?.values() || [])].map(({ ref, name, mediaType, data }) => ({
      ref,
      name,
      mediaType,
      bytes: data.length,
    }));
  }
  async resolve(
    task: AppUseTask,
    schema: unknown,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const parsed = AppParameterSchema.parse(schema);
    const input = JSON.parse(JSON.stringify(params)) as AppJson;
    parsed.validate(input);
    return (await parsed.resolveFiles(input, async (ref) => {
      if (!/^sha256:[a-f0-9]{64}$/.test(ref))
        throw new AppUseError(
          'APP_FILE_REFERENCE',
          'Use a current conversation file reference from inventory.',
        );
      const file = this.files.get(task.thread)?.get(ref);
      if (!file)
        throw new AppUseError('APP_FILE_FOREIGN', 'The selected file does not belong to this conversation.');
      const token = randomBytes(32).toString('hex');
      this.grants.set(token, {
        file,
        taskId: task.id,
        threadId: task.thread,
        app: task.scope.app,
        panel: task.scope.panel,
        expiresAt: task.expiresAt,
      });
      return `/host/inputs/${token}`;
    })) as Record<string, unknown>;
  }
  read(app: string, token: string, now: number): InputGrant {
    const grant = this.grants.get(token);
    if (!grant || grant.app !== app || now >= grant.expiresAt)
      throw new AppUseError('APP_INPUT_EXPIRED', 'This App input grant is absent or expired.');
    return grant;
  }
  forget(thread?: string) {
    if (thread) this.files.delete(thread);
    else this.files.clear();
    for (const [token, grant] of this.grants)
      if (!thread || grant.threadId === thread) this.grants.delete(token);
  }
}
