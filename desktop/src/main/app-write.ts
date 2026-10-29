import { createHash } from 'node:crypto';
import { AppParameterSchema, type AppJson } from '../../../packages/app-sdk/src/app-use.ts';
import { AppUseError } from './app-use-task.ts';

export type AppWriteDefinition = Readonly<{
  app: string;
  panel: string;
  version: string;
  name: string;
  description: string;
  path: string;
  schema: Record<string, unknown>;
}>;
/** A prepared write fixes both the document and the installed route before execution. */
export class PreparedAppWrite {
  readonly definition: AppWriteDefinition;
  readonly document: AppJson;
  readonly digest: string;
  private fingerprint: string;
  constructor(definition: AppWriteDefinition, document: unknown) {
    const text = JSON.stringify(document);
    if (!text || Buffer.byteLength(text) > 1000000)
      throw new AppUseError('APP_WRITE_INVALID', 'App documents must fit in 1 MiB');
    const value = JSON.parse(text) as AppJson;
    AppParameterSchema.parse(definition.schema).validate(value);
    this.definition = definition;
    this.document = value;
    this.digest = createHash('sha256').update(text).digest('hex');
    this.fingerprint = JSON.stringify(definition);
  }
  requireCurrent(current: AppWriteDefinition | undefined) {
    if (!current || JSON.stringify(current) !== this.fingerprint)
      throw new AppUseError(
        'APP_WRITE_CHANGED',
        'The App write route changed before execution. Describe it again before writing.',
      );
  }
}
export function parseAppWrite(value: unknown): { app: string; tool: string; document: unknown } {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AppUseError('APP_WRITE_INVALID', 'App write needs app, tool and document');
  const r = value as Record<string, unknown>;
  if (
    Object.keys(r).some((key) => !['app', 'tool', 'document'].includes(key)) ||
    typeof r.app !== 'string' ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(r.app) ||
    typeof r.tool !== 'string' ||
    !/^[a-z][a-z0-9_-]{0,63}$/.test(r.tool) ||
    !Object.hasOwn(r, 'document')
  )
    throw new AppUseError(
      'APP_WRITE_INVALID',
      'Use only app, tool and document; routing belongs to the Host.',
    );
  return r as { app: string; tool: string; document: unknown };
}
