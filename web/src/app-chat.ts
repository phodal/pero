import type { ContextReference } from '../../protocol/generated/host';
import type { AppChatLaunch } from '../../packages/app-sdk/src/app-chat';
export type AppDraft = { threadId?: string; scope?: { app: string; panel: string } };
export type AppChatIntent = { name: string; panel: string; text?: string; options?: unknown };

/** Both parent shells use one draft-bound context handoff. */
export function appChatLauncher(ports: {
  open(scope: { app: string; panel: string }): void;
  draft(): Promise<AppDraft | undefined>;
  command(value: object): Promise<unknown>;
  deliver(thread: string, context: ContextReference[], message: string, replace: boolean): void;
}) {
  return async (intent: AppChatIntent) => {
    const scope = { app: intent.name, panel: intent.panel };
    ports.open(scope);
    const deadline = performance.now() + 5000;
    let draft = await ports.draft();
    while (!draft?.threadId || draft.scope?.app !== scope.app || draft.scope.panel !== scope.panel) {
      if (performance.now() >= deadline)
        throw new Error('The App conversation is not ready. Open Chat and retry.');
      await new Promise(requestAnimationFrame);
      draft = await ports.draft();
    }
    const options = (intent.options || { message: intent.text || '' }) as AppChatLaunch;
    const contexts = (await ports.command({
      action: 'context',
      thread_id: draft.threadId,
      scope,
      options,
    })) as ContextReference[];
    ports.deliver(
      draft.threadId,
      contexts,
      typeof options.message === 'string' ? options.message : '',
      options.mode === 'replace',
    );
    return { threadId: draft.threadId, references: contexts.map((ref) => ref.id) };
  };
}
