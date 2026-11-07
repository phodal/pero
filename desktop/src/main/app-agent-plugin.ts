import { isDeepStrictEqual } from 'node:util';
import type { AppScope } from './app-use-task.ts';
import { AppUseError } from './app-use-task.ts';
import type { AppWriteDefinition } from './app-write.ts';

type AppPluginDeclaration = Readonly<{
  app: string;
  revision: string;
  tools: readonly Pick<AppWriteDefinition, 'name' | 'description' | 'path' | 'schema'>[];
  maxCalls: number;
  hostBudgeted?: boolean;
}>;

/** One Host-mounted App plugin. Its call budget lasts for this ACP connection. */
export class AppAgentPluginBinding {
  readonly snapshot: AppPluginDeclaration;
  readonly scope: Readonly<AppScope>;
  readonly calls: number;
  private constructor(snapshot: AppPluginDeclaration, scope: AppScope, calls = 0) {
    this.snapshot = snapshot;
    this.scope = scope;
    this.calls = calls;
  }
  static bind(snapshot: AppPluginDeclaration, scope: AppScope): AppAgentPluginBinding {
    if (snapshot.app !== scope.app || !/^[a-f0-9]{64}$/.test(snapshot.revision)
      || !Number.isInteger(snapshot.maxCalls) || snapshot.maxCalls < 1) {
      throw new AppUseError('APP_PLUGIN_INVALID', 'The App plugin must match its Host conversation scope.');
    }
    return new AppAgentPluginBinding(structuredClone(snapshot), { ...scope });
  }
  definitions(current: readonly AppWriteDefinition[]): AppWriteDefinition[] {
    const selected = this.snapshot.tools.map(tool => {
      const definition = current.find(value => value.app === this.snapshot.app && value.name === tool.name
        && value.revision === this.snapshot.revision);
      if (!definition || !isDeepStrictEqual(
        { name: definition.name, description: definition.description, path: definition.path, schema: definition.schema }, tool,
      )) throw new AppUseError('APP_PLUGIN_CHANGED', 'The installed App plugin changed or is disabled. Open a new App conversation.');
      return definition;
    });
    return this.snapshot.hostBudgeted || this.calls < this.snapshot.maxCalls ? selected : [];
  }
  consume(definition: AppWriteDefinition, current: readonly AppWriteDefinition[]): AppAgentPluginBinding {
    if (!this.snapshot.hostBudgeted && this.calls >= this.snapshot.maxCalls)
      throw new AppUseError('APP_PLUGIN_BUDGET', 'This App plugin reached its call limit for this Agent connection.');
    if (!this.definitions(current).includes(definition))
      throw new AppUseError('APP_PLUGIN_TOOL_DENIED', 'This App plugin did not declare that tool.');
    return new AppAgentPluginBinding(this.snapshot, this.scope, this.calls + (this.snapshot.hostBudgeted ? 0 : 1));
  }
}
