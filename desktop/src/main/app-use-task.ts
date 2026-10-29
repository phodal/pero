/** App Use authorization is bound to one live session, panel instance and action set. */
export const APP_USE_ACTIONS = [
  'observe',
  'capture',
  'semantic.invoke',
  'dom.click',
  'dom.fill',
  'verify',
] as const;
export const APP_USE_VERBS = [
  'inventory',
  'start',
  'describe',
  'observe',
  'capture',
  'wait',
  'act',
  'verify',
  'runPlan',
  'stop',
] as const;
export type AppUseAction = (typeof APP_USE_ACTIONS)[number];
export type AppUseVerb = (typeof APP_USE_VERBS)[number];
export type AppScope = Readonly<{ app: string; panel: string }>;
export type AppSurface = {
  app: string;
  panel: string;
  surfaceId: string;
  instance: string;
  visible: boolean;
  active: boolean;
  operable: boolean;
  capturable?: boolean;
  rect: { x: number; y: number; width: number; height: number };
};
export class AppUseError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
export function fail(code: string, message: string): never {
  throw new AppUseError(code, message);
}
export const reading = (actions: readonly AppUseAction[]) =>
  actions.every((action) => ['observe', 'capture', 'verify'].includes(action));
export class AppUseTask {
  ended = false;
  expiresAt: number;
  readonly actions: readonly AppUseAction[];
  readonly id: string;
  readonly thread: string;
  readonly surfaceId: string;
  readonly instance: string;
  readonly standing: boolean;
  readonly scope: AppScope;
  constructor(
    id: string,
    thread: string,
    surface: AppSurface,
    actions: readonly AppUseAction[],
    standing: boolean,
    now: number,
  ) {
    this.id = id;
    this.thread = thread;
    this.surfaceId = surface.surfaceId;
    this.instance = surface.instance;
    this.scope = Object.freeze({ app: surface.app, panel: surface.panel });
    this.standing = standing;
    if (!actions.length || actions.some((action) => !APP_USE_ACTIONS.includes(action)))
      fail('APP_USE_INVALID', 'Choose the actions this task needs.');
    this.actions = Object.freeze([...new Set<AppUseAction>(['observe', ...actions])]);
    if (standing && !reading(this.actions))
      fail('APP_USE_INVALID', 'Session grants cover reading only. Request operation per task.');
    this.expiresAt = now + 300_000;
  }
  renewable(standing: boolean) {
    return standing && reading(this.actions);
  }
  authorize(thread: string, surface: AppSurface, action: AppUseAction, now: number, standing: boolean) {
    if (this.ended || thread !== this.thread) fail('APP_TASK_ENDED', 'This App Use task has ended.');
    if (surface.surfaceId !== this.surfaceId || surface.instance !== this.instance) {
      this.ended = true;
      fail('APP_SURFACE_REPLACED', 'The panel changed. Start a new task.');
    }
    if (now >= this.expiresAt) {
      if (!this.renewable(standing)) {
        this.ended = true;
        fail('APP_TASK_EXPIRED', 'The task expired. Start a new task.');
      }
      this.expiresAt = now + 300_000;
    }
    if (!this.actions.includes(action)) fail('APP_ACTION_DENIED', 'This action was not granted to the task.');
    if ((!reading([action]) || action === 'capture') && !surface.operable)
      fail(
        surface.capturable ? 'APP_USER_ACTIVE' : 'APP_SURFACE_HIDDEN',
        surface.capturable
          ? 'The user is operating this App. Wait for them to finish.'
          : 'Show this App panel before operating or capturing it.',
      );
  }
}
export type AppUseRequest = {
  action: AppUseVerb;
  surfaceId?: string;
  taskId?: string;
  actions?: AppUseAction[];
  scope?: 'task' | 'session';
  target?: string;
  command?: 'semantic.invoke' | 'dom.click' | 'dom.fill';
  name?: string;
  params?: Record<string, unknown>;
  expectedRevisions?: Record<string, unknown>;
  check?: Record<string, unknown>;
  until?: Record<string, unknown>;
  timeoutMs?: number;
  steps?: { id: string; request: Record<string, unknown> }[];
};
export function parseAppUseRequest(value: unknown): AppUseRequest {
  const r = value as Record<string, unknown>;
  const fields = [
    'action',
    'surfaceId',
    'taskId',
    'actions',
    'scope',
    'target',
    'command',
    'name',
    'params',
    'expectedRevisions',
    'check',
    'until',
    'timeoutMs',
    'steps',
  ];
  const object = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);
  if (
    !object(r) ||
    Object.keys(r).some((key) => !fields.includes(key)) ||
    !APP_USE_VERBS.includes(r.action as AppUseVerb)
  )
    fail('APP_USE_INVALID', 'Unknown App Use request.');
  for (const key of ['surfaceId', 'taskId', 'target', 'name'])
    if (
      r[key] !== undefined &&
      (typeof r[key] !== 'string' || !(r[key] as string).length || (r[key] as string).length > 256)
    )
      fail('APP_USE_INVALID', `Invalid ${key}.`);
  if (r.scope !== undefined && !['task', 'session'].includes(r.scope as string))
    fail('APP_USE_INVALID', 'Unknown grant scope.');
  if (r.command !== undefined && !['semantic.invoke', 'dom.click', 'dom.fill'].includes(r.command as string))
    fail('APP_USE_INVALID', 'Unknown App command.');
  if (
    r.actions !== undefined &&
    (!Array.isArray(r.actions) || r.actions.some((a) => !APP_USE_ACTIONS.includes(a)))
  )
    fail('APP_USE_INVALID', 'Unknown task action.');
  for (const key of ['params', 'expectedRevisions', 'check', 'until'])
    if (r[key] !== undefined && !object(r[key])) fail('APP_USE_INVALID', `Invalid ${key}.`);
  if (
    r.timeoutMs !== undefined &&
    (!Number.isInteger(r.timeoutMs) || (r.timeoutMs as number) < 1 || (r.timeoutMs as number) > 60000)
  )
    fail('APP_USE_INVALID', 'Timeout must be 1–60000 ms.');
  if (
    r.steps !== undefined &&
    (!Array.isArray(r.steps) ||
      !r.steps.length ||
      r.steps.length > 20 ||
      r.steps.some(
        (step) =>
          !object(step) ||
          typeof step.id !== 'string' ||
          !/^[A-Za-z][\w-]{0,40}$/.test(step.id) ||
          !object(step.request),
      ) ||
      new Set(r.steps.map((s) => s.id)).size !== r.steps.length)
  )
    fail('APP_USE_INVALID', 'A plan needs 1–20 uniquely named steps.');
  return r as AppUseRequest;
}
