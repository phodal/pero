import { z } from 'zod';
import { BROWSER_KEYS } from './input.ts';

const ref = z.string().regex(/^[a-f0-9-]{36}:\d{1,3}$/);
const label = z.string().trim().min(1).max(256);
const tab = { tabId: z.string().min(1).max(4096).optional() };
const frameSelector = z.strictObject({ by: z.enum(['title', 'testId']), value: label });
const frame = z.array(frameSelector).max(4).optional();
const locator = z.discriminatedUnion('by', [
  z.strictObject({ by: z.literal('role'), role: label, name: label.optional() }),
  z.strictObject({ by: z.literal('label'), value: label }),
  z.strictObject({ by: z.literal('text'), value: label }),
  z.strictObject({ by: z.literal('testId'), value: label }),
]);
const condition = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('visible') }),
  z.strictObject({ kind: z.literal('hidden') }),
  z.strictObject({ kind: z.literal('enabled') }),
  z.strictObject({ kind: z.literal('checked'), value: z.boolean() }),
  z.strictObject({ kind: z.literal('value'), value: z.string().max(512) }),
  z.strictObject({ kind: z.literal('text'), value: label }),
]);

export const browserRequest = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('tabs') }),
  z.strictObject({ ...tab, action: z.literal('open'), url:z.string().max(4096) }),
  z.strictObject({ action: z.literal('activate'), tabId:z.string().min(1).max(4096) }),
  z.strictObject({ action: z.literal('closeTab'), tabId:z.string().min(1).max(4096) }),
  z.strictObject({ ...tab, action: z.literal('back') }),
  z.strictObject({ ...tab, action: z.literal('forward') }),
  z.strictObject({ ...tab, action: z.literal('reload') }),
  z.strictObject({ ...tab, action: z.literal('files') }),
  z.strictObject({ ...tab, action: z.literal('upload'), ref, fileRef: z.string().regex(/^sha256:[a-f0-9]{64}$/) }),
  z.strictObject({ ...tab, action: z.literal('download'), ref }),
  z.strictObject({ ...tab, action: z.literal('status') }),
  z.strictObject({ ...tab, action: z.literal('observe'), frame }),
  z.strictObject({ ...tab, action: z.literal('locate'), locator, frame }),
  z.strictObject({ ...tab, action: z.literal('wait'), locator, frame, condition,
    timeoutMs: z.number().int().min(1).max(10000).optional() }),
  z.strictObject({ ...tab, action: z.literal('click'), ref }),
  z.strictObject({ ...tab, action: z.literal('fill'), ref, text: z.string().max(4096) }),
  z.strictObject({ ...tab, action: z.literal('press'), ref, key: z.enum(BROWSER_KEYS) }),
  z.strictObject({ ...tab, action: z.literal('setChecked'), ref, checked: z.boolean() }),
  z.strictObject({ ...tab, action: z.literal('selectOption'), ref, value: z.string().max(512) }),
  z.strictObject({
    ...tab, action: z.literal('scroll'), observationId: z.uuid(),
    deltaX: z.number().int().min(-2000).max(2000),
    deltaY: z.number().int().min(-2000).max(2000),
  }),
  z.strictObject({ ...tab, action: z.literal('screenshot') }),
  z.strictObject({ ...tab, action: z.literal('navigate'), url: z.string().max(4096) }),
]);

export type BrowserRequest = z.infer<typeof browserRequest>;
export type FrameSelector = z.infer<typeof frameSelector>;
export type Locator = z.infer<typeof locator>;
export type WaitCondition = z.infer<typeof condition>;
