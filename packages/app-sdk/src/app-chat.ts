import type { AppJson } from './app-use';

export type AppChatAttachment = {
  type: 'app-object' | 'app-summary';
  objectId: string;
  revision: number;
  selection?: AppJson;
};
export type AppChatLaunch = {
  message?: string;
  mode?: 'append' | 'replace';
  attachments?: AppChatAttachment[];
  capture?: boolean;
};

/** The launch request carries references; the trusted shell freezes their content. */
export function parseAppChatLaunch(value: unknown): AppChatLaunch {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid App chat request');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !['message', 'mode', 'attachments', 'capture'].includes(key)))
    throw new Error('Unknown App chat option');
  if (record.message !== undefined && (typeof record.message !== 'string' || record.message.length > 64000))
    throw new Error('App chat message exceeds 64000 characters');
  if (record.mode !== undefined && !['append', 'replace'].includes(record.mode as string))
    throw new Error('Unknown draft mode');
  if (record.capture !== undefined && typeof record.capture !== 'boolean')
    throw new Error('Invalid capture option');
  if (record.attachments !== undefined) {
    if (!Array.isArray(record.attachments) || record.attachments.length > 12)
      throw new Error('Choose at most 12 App references');
    for (const input of record.attachments) {
      if (
        !input ||
        typeof input !== 'object' ||
        Array.isArray(input) ||
        Object.keys(input).some((key) => !['type', 'objectId', 'revision', 'selection'].includes(key)) ||
        !['app-object', 'app-summary'].includes(input.type) ||
        typeof input.objectId !== 'string' ||
        !/^[A-Za-z0-9][\w.:-]{0,127}$/.test(input.objectId) ||
        !Number.isSafeInteger(input.revision) ||
        input.revision < 1
      )
        throw new Error('Invalid App object reference');
      if (
        input.selection !== undefined &&
        new TextEncoder().encode(JSON.stringify(input.selection)).length > 4096
      )
        throw new Error('App selection exceeds 4 KiB');
    }
  }
  return JSON.parse(JSON.stringify(record)) as AppChatLaunch;
}
