// Requests from the paired Chrome extension, scoped to its Host-bound conversation.
import { z } from 'zod';

const image = z.strictObject({
  id: z.uuid(), kind: z.literal('image'), label: z.string().min(1).max(200), source: z.literal('chrome-sidebar'),
  content: z.strictObject({ type: z.literal('image'), mime_type: z.enum(['image/png','image/jpeg','image/webp']),
    data: z.string().min(1).max(12_000_000) }),
});
export const sidebarRequest = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('snapshot') }), z.strictObject({ kind: z.literal('open') }),
  z.strictObject({ kind: z.literal('create') }), z.strictObject({ kind: z.literal('stop') }),
  z.strictObject({ kind: z.literal('select'), id: z.string().min(1).max(256) }),
  z.strictObject({ kind: z.literal('send'), text: z.string().max(64000), contexts: z.array(image).max(4) }),
  z.strictObject({ kind: z.literal('edit'), before: z.string().max(64000), start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), insert: z.string().max(64000) }),
  z.strictObject({ kind: z.literal('choose'), text: z.string().max(64000), index: z.number().int().nonnegative(), label: z.string() }),
  z.strictObject({ kind: z.literal('dismiss') }),
  z.strictObject({ kind: z.literal('model'), id: z.string().min(1) }),
  z.strictObject({ kind: z.literal('submit'), text: z.string().max(64000), contexts: z.array(image).max(4) }),
  z.strictObject({ kind: z.literal('collect'), grant: z.uuid(), url: z.string().max(4096), title: z.string().trim().min(1).max(512),
    content: z.string().trim().min(1).max(200000), reason: z.string().max(2048), question: z.string().max(2048) }),
]);
export type SidebarPort = (thread: string, request: z.infer<typeof sidebarRequest>, check: () => void) => Promise<unknown>;
