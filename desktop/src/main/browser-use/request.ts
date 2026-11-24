import { z } from 'zod';
import { BROWSER_KEYS, BROWSER_MODIFIERS } from './input.ts';
import { webOrigin } from '../../../../packages/chrome-extension/src/protocol.ts';

const ref = z.string().regex(/^[a-f0-9-]{36}:\d{1,3}$/);
const fileRef = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const label = z.string().trim().min(1).max(256);
const optionValue = z.string().max(512);
const tab = { tabId: z.string().min(1).max(4096).optional() };
const target = { ...tab, background: z.literal(true).optional() };
const origin = z.string().max(512).refine(value => webOrigin(value) === value);
const cdpTarget = z.strictObject({ id: z.uuid(), origin });
const frameSelector = z.strictObject({ by: z.enum(['title', 'testId']), value: label });
const frame = z.array(frameSelector).max(4).optional();
const locator = z.discriminatedUnion('by', [
  z.strictObject({ by: z.literal('role'), role: label, name: label.optional() }),
  z.strictObject({ by: z.literal('label'), value: label }),
  z.strictObject({ by: z.literal('text'), value: label }),
  z.strictObject({ by: z.literal('testId'), value: label }),
  z.strictObject({ by: z.literal('placeholder'), value: label }),
]);
const condition = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('visible') }),
  z.strictObject({ kind: z.literal('hidden') }),
  z.strictObject({ kind: z.literal('enabled') }),
  z.strictObject({ kind: z.literal('checked'), value: z.boolean() }),
  z.strictObject({ kind: z.literal('value'), value: z.string().max(512) }),
  z.strictObject({ kind: z.literal('text'), value: label }),
]);
const timeoutMs = z.number().int().min(1).max(10000).optional();
const elementOperations = [
  z.strictObject({ action: z.literal('click'), expectPopup: z.boolean().optional() }),
  z.strictObject({ action: z.literal('dblclick') }),
  z.strictObject({ action: z.literal('hover') }),
  z.strictObject({ action: z.literal('fill'), text: z.string().max(4096) }),
  z.strictObject({ action: z.literal('press'), key: z.union([z.enum(BROWSER_KEYS), z.string().regex(/^[a-zA-Z0-9]$/)]),
    modifiers: z.array(z.enum(BROWSER_MODIFIERS)).max(4).optional() }),
  z.strictObject({ action: z.literal('typeSequentially'), text: z.string().regex(/^[a-zA-Z0-9 ]{1,160}$/) }),
  z.strictObject({ action: z.literal('scrollIntoView') }),
  z.strictObject({ action: z.literal('setChecked'), checked: z.boolean() }),
  z.strictObject({ action: z.literal('selectOption'), value: z.union([optionValue, z.array(optionValue).max(64)]) }),
] as const;

export const browserRequest = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('tabs') }),
  z.strictObject({ ...tab, action: z.literal('open'), url:z.string().max(4096) }),
  z.strictObject({ action: z.literal('activate'), tabId:z.string().min(1).max(4096) }),
  z.strictObject({ action: z.literal('closeTab'), tabId:z.string().min(1).max(4096) }),
  z.strictObject({ action: z.literal('handoff'), tabId:z.string().min(1).max(4096) }),
  z.strictObject({ ...tab, action: z.literal('getJsDialog') }),
  z.strictObject({ ...tab, action: z.literal('handleJsDialog'), dialogId: z.uuid(),
    decision: z.enum(['accept', 'dismiss']), promptText: z.string().max(4096).optional() }),
  z.strictObject({ ...target, action: z.literal('back') }),
  z.strictObject({ ...target, action: z.literal('forward') }),
  z.strictObject({ ...target, action: z.literal('reload') }),
  z.strictObject({ ...tab, action: z.literal('files') }),
  z.strictObject({ ...target, action: z.literal('upload'), ref, fileRef: fileRef.optional(), fileRefs: z.array(fileRef).min(1).max(8).optional() })
    .refine(value => !!value.fileRef !== !!value.fileRefs, 'Choose exactly one of fileRef and fileRefs.'),
  z.strictObject({ ...target, action: z.literal('download'), ref }),
  z.strictObject({ ...tab, action: z.literal('status'), provider: z.enum(['chrome', 'embedded']).optional() }),
  z.strictObject({ ...target, action: z.literal('getAXState'), since: z.uuid().optional() }),
  z.strictObject({ ...target, action: z.literal('diagnose'),
    captureMs: z.number().int().min(100).max(4000).optional(), profile: z.boolean().optional(),
    style: z.strictObject({ selector: label, properties: z.array(z.string().regex(/^[-a-zA-Z0-9]{1,64}$/)).min(1).max(16) }).optional() }),
  z.strictObject({ ...target, action: z.literal('cdpListTargets'), fromOrigins: z.array(origin).max(4).optional(),
    depth: z.number().int().min(1).max(4).optional() }),
  z.strictObject({ ...target, action: z.literal('cdpSend'),
    target: cdpTarget.optional(), command: z.discriminatedUnion('method', [
    z.strictObject({ method: z.literal('Page.getLayoutMetrics') }),
    z.strictObject({ method: z.literal('Page.getFrameTree') }),
    z.strictObject({ method: z.literal('Page.getResourceTree') }),
    z.strictObject({ method: z.literal('Performance.getMetrics') }),
    z.strictObject({ method: z.literal('DOM.getDocument'), params: z.strictObject({ depth: z.union([z.literal(0), z.literal(1)]) }).optional() }),
    z.strictObject({ method: z.literal('Network.enable') }),
    z.strictObject({ method: z.literal('Network.disable') }),
    z.strictObject({ method: z.literal('Network.getResponseBody'),
      params: z.strictObject({ requestId: z.string().min(1).max(128) }) }),
  ]) }).refine(value => !value.target || !value.command.method.startsWith('Network.'),
    'Child targets support read-only Page, DOM and Performance commands.'),
  z.strictObject({ ...target, action: z.literal('cdpReadEvents'), target: cdpTarget.optional(),
    after: z.strictObject({ stream: z.uuid(), sequence: z.number().int().nonnegative().safe() }).optional(),
    timeoutMs: z.number().int().min(1).max(4000).optional(),
    limit: z.number().int().min(1).max(50).optional(),
    methods: z.array(z.enum(['Runtime.consoleAPICalled', 'Runtime.exceptionThrown', 'Network.requestWillBeSent',
      'Network.responseReceived', 'Network.loadingFinished', 'Network.loadingFailed'])).min(1).max(6).optional() })
    .refine(value => !value.target || (!value.timeoutMs && !value.methods?.some(method => method.startsWith('Network.'))),
      'Child targets support Runtime event replay.'),
  z.strictObject({ ...tab, action: z.literal('listSiteTools'),
    fromOrigins: z.array(origin).max(4).optional() }),
  z.strictObject({ ...tab, action: z.literal('callSiteTool'), toolId: z.uuid(),
    input: z.record(z.string(), z.json()).refine(input => Buffer.byteLength(JSON.stringify(input)) <= 4096,
      'Site tool input must fit within 4 KiB.') }),
  z.strictObject({ ...target, action: z.literal('observe'), frame, includeTree: z.boolean().optional(),
    includeFrameContents: z.boolean().optional() }),
  z.strictObject({ ...target, action: z.literal('locate'), locator, frame, within: locator.optional() }),
  z.strictObject({ ...target, action: z.literal('query'), locator, frame, within: locator.optional(),
    limit: z.number().int().min(0).max(64).optional() }),
  z.strictObject({ ...target, action: z.literal('wait'), locator, frame, within: locator.optional(), condition, timeoutMs }),
  z.strictObject({ ...target, action: z.literal('act'), locator, frame, within: locator.optional(), timeoutMs,
    operation: z.discriminatedUnion('action', elementOperations) }),
  ...elementOperations.map(operation => operation.extend({ ...target, ref })),
  z.strictObject({
    ...target, action: z.literal('scroll'), observationId: z.uuid(),
    deltaX: z.number().int().min(-2000).max(2000),
    deltaY: z.number().int().min(-2000).max(2000),
  }),
  z.strictObject({ ...target, action: z.literal('screenshot'), fullPage: z.boolean().optional(), clip: z.strictObject({
    x: z.number().int().nonnegative(), y: z.number().int().nonnegative(),
    width: z.number().int().positive(), height: z.number().int().positive(),
  }).optional() }).refine(value => !value.fullPage || !value.clip, 'Choose either fullPage or a viewport clip.'),
  z.strictObject({ ...target, action: z.literal('navigate'), url: z.string().max(4096) }),
]);

export const browserInputSchema = { type: 'object', ...z.toJSONSchema(browserRequest, { target: 'draft-7', unrepresentable: 'throw' }) };
export type BrowserRequest = z.infer<typeof browserRequest>;
export type CdpRequest = Extract<BrowserRequest, { action: 'cdpSend' | 'cdpReadEvents' }>;
export type CdpTargetRequest = Extract<BrowserRequest, { action: 'cdpListTargets' }> |
  (CdpRequest & { target: z.infer<typeof cdpTarget> });
export function cdpTargetRequest(request: BrowserRequest): request is CdpTargetRequest {
  return request.action === 'cdpListTargets' || (request.action === 'cdpSend' || request.action === 'cdpReadEvents') && !!request.target;
}
export function browserDeveloperAction(action: BrowserRequest['action']) {
  return action === 'diagnose' || action === 'cdpSend' || action === 'cdpReadEvents' || action === 'cdpListTargets';
}
export type FrameSelector = z.infer<typeof frameSelector>;
export type Locator = z.infer<typeof locator>;
export type WaitCondition = z.infer<typeof condition>;
