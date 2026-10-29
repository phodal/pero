import { randomUUID, createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { setTimeout as poll } from 'node:timers/promises';
import type { AppCaptureReceipt } from './app-evidence.ts';
import {
  AppUseTask,
  AppUseError,
  fail,
  parseAppUseRequest,
  reading,
  type AppScope,
  type AppSurface,
  type AppUseRequest,
  type AppUseAction,
} from './app-use-task.ts';

export type AppUseEvent = { kind: string; thread_id?: string; data?: unknown; text?: string };
type AppUseCall = { controller: AbortController; scope?: AppScope };
type Session = {
  scope?: AppScope;
  visited: Map<string, AppScope>;
  title: string;
  epoch: number;
  running: boolean;
};
type Evidence = {
  id: string;
  taskId: string;
  target?: string;
  instance: string;
  png: Buffer;
  pixels: Buffer;
  width: number;
  height: number;
  sha256: string;
  path?: string;
};
async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort: () => void = () => {};
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        abort = () =>
          reject(
            new AppUseError(
              'APP_USE_INTERRUPTED',
              'App Use stopped waiting. An operation already sent may have taken effect; observe before continuing.',
            ),
          );
        signal.addEventListener('abort', abort, { once: true });
      }),
    ]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
type Snapshot = {
  objects: { id: string; revision: number; state: Record<string, unknown> }[];
  text?: string;
  dom?: { role: string; label: string }[];
  domTruncated?: boolean;
  textTruncated?: boolean;
  revisions?: Record<string, unknown>;
};
export type AppUsePorts = {
  page(scope: AppScope | undefined, request: Record<string, unknown>): Promise<unknown>;
  selectedThread(): Promise<string | undefined>;
  capture(
    rect: AppSurface['rect'],
    id: string,
  ): Promise<{ png: Buffer; pixels: Buffer; width: number; height: number; path?: string }>;
  presence(
    thread: string,
    data: {
      scope: AppScope;
      title: string;
      standing: AppUseAction[];
      tasks: { id: string; actions: readonly AppUseAction[]; expiresAt: number }[];
    },
  ): void;
  fileReferences?(thread: string): unknown[];
  resolveFileParameters?(
    task: AppUseTask,
    schema: unknown,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  recordEvidence?(receipt: AppCaptureReceipt): Promise<void>;
  now?(): number;
};

/** Trusted Desktop owner of task grants; App documents own only the declared UI state. */
export class AppUse {
  private sessions = new Map<string, Session>();
  private tasks = new Map<string, AppUseTask>();
  private grants = new Map<string, AppUseAction[]>();
  private evidence = new Map<string, Evidence>();
  private calls = new Map<string, Set<AppUseCall>>();
  private selected?: string;
  private pendingTurns = new Set<string>();
  private turnWaiters = new Map<string, Set<(ready: boolean) => void>>();
  private ports: AppUsePorts;
  constructor(ports: AppUsePorts) {
    this.ports = ports;
  }
  private now() {
    return this.ports.now?.() ?? Date.now();
  }
  accept(event: AppUseEvent) {
    const thread = event.thread_id;
    if (event.kind === 'replay') {
      const data = event.data as { events?: AppUseEvent[]; active?: string[] };
      const restored = new Set<string>();
      for (const entry of data?.events || []) {
        if (entry.kind === 'session_created' && entry.thread_id && !this.sessions.has(entry.thread_id))
          restored.add(entry.thread_id);
        if (entry.thread_id && restored.has(entry.thread_id)) this.accept(entry);
      }
      for (const id of restored)
        if (!data.active?.includes(id)) {
          const session = this.sessions.get(id);
          if (session) session.running = false;
        }
      return;
    }
    if (event.kind === 'session_created' && thread) {
      const data = event.data as { scope?: AppScope; agent?: string };
      this.sessions.set(thread, {
        scope: data?.scope,
        visited: new Map(),
        title: data?.agent || 'Agent',
        epoch: 0,
        running: false,
      });
    } else if (thread && ['session_closed', 'session_deleted'].includes(event.kind)) {
      this.revoke(thread);
      this.sessions.delete(thread);
    } else if (thread && event.kind === 'turn_started') {
      const session = this.sessions.get(thread);
      if (session) session.running = true;
      this.pendingTurns.delete(thread);
      for (const notify of this.turnWaiters.get(thread) || []) notify(true);
      this.turnWaiters.delete(thread);
    } else if (thread && ['turn_finished', 'session_error'].includes(event.kind)) {
      const session = this.sessions.get(thread);
      if (session) session.running = false;
    } else if (event.kind === 'disconnected') this.reset(true);
  }
  command(value: { action?: string; thread_id?: string }) {
    if (!value.thread_id) return;
    if (value.action === 'prompt') this.pendingTurns.add(value.thread_id);
    if (['cancel', 'close', 'delete'].includes(value.action || '')) {
      this.pendingTurns.delete(value.thread_id);
      for (const notify of this.turnWaiters.get(value.thread_id) || []) notify(false);
      this.turnWaiters.delete(value.thread_id);
      this.revoke(value.thread_id);
      const session = this.sessions.get(value.thread_id);
      if (session) session.running = false;
    }
  }
  private end(task: AppUseTask) {
    task.ended = true;
    this.tasks.delete(task.id);
    for (const [id, image] of this.evidence) if (image.taskId === task.id) this.evidence.delete(id);
  }
  private endTasks(thread: string) {
    for (const task of this.tasks.values()) if (task.thread === thread) this.end(task);
    for (const call of this.calls.get(thread) || []) call.controller.abort();
    this.calls.delete(thread);
    this.publish(thread);
  }
  revoke(thread: string, scope?: AppScope) {
    if (!scope) {
      for (const key of this.grants.keys()) if (key.startsWith(thread + '\0')) this.grants.delete(key);
      const session = this.sessions.get(thread);
      if (session) session.epoch++;
      this.endTasks(thread);
      return;
    }
    this.grants.delete(this.grantKey(thread, scope));
    for (const task of this.tasks.values())
      if (task.thread === thread && task.scope.app === scope.app && task.scope.panel === scope.panel)
        this.end(task);
    for (const call of this.calls.get(thread) || [])
      if (call.scope?.app === scope.app && call.scope.panel === scope.panel) call.controller.abort();
    this.publish(thread);
  }
  select(thread: string | undefined) {
    if (this.selected !== thread) {
      this.reset();
      this.selected = thread;
    }
  }
  reset(forget = false) {
    for (const thread of this.sessions.keys()) {
      if (forget)
        for (const key of this.grants.keys()) if (key.startsWith(thread + '\0')) this.grants.delete(key);
      this.endTasks(thread);
      const session = this.sessions.get(thread)!;
      session.epoch++;
    }
    if (forget) {
      this.sessions.clear();
      this.pendingTurns.clear();
      for (const waiters of this.turnWaiters.values()) for (const notify of waiters) notify(false);
      this.turnWaiters.clear();
    }
    this.selected = undefined;
  }
  private grantKey(thread: string, scope: AppScope) {
    return `${thread}\0${scope.app}\0${scope.panel}`;
  }
  private publish(thread: string) {
    const session = this.sessions.get(thread);
    if (!session) return;
    for (const scope of session.visited.values())
      this.ports.presence(thread, {
        scope,
        title: session.title,
        standing: this.grants.get(this.grantKey(thread, scope)) || [],
        tasks: [...this.tasks.values()]
          .filter(
            (t) =>
              t.thread === thread &&
              t.scope.app === scope.app &&
              t.scope.panel === scope.panel &&
              !t.ended &&
              t.expiresAt > this.now(),
          )
          .map((t) => ({ id: t.id, actions: t.actions, expiresAt: t.expiresAt })),
      });
  }
  private async session(thread: string) {
    const selected = await this.ports.selectedThread();
    this.select(selected);
    if (this.pendingTurns.has(thread) && !this.sessions.get(thread)?.running) {
      const ready = await new Promise<boolean>((resolve) => {
        const waiters = this.turnWaiters.get(thread) || new Set<(ready: boolean) => void>();
        const finish = (ready: boolean) => {
          clearTimeout(timer);
          waiters.delete(finish);
          if (!waiters.size) this.turnWaiters.delete(thread);
          resolve(ready);
        };
        const timer = setTimeout(() => finish(false), 5000);
        waiters.add(finish);
        this.turnWaiters.set(thread, waiters);
      });
      if (!ready) fail('APP_TURN_UNAVAILABLE', 'The Host did not start the requested turn.');
    }
    const session = this.sessions.get(thread);
    if (!session || !session.running || selected !== thread)
      fail('APP_SESSION_INACTIVE', 'App Use belongs to the running conversation selected in Chat.');
    return session;
  }
  private async page(
    session: Session,
    request: Record<string, unknown>,
    signal?: AbortSignal,
    task?: AppUseTask,
  ) {
    const epoch = session.epoch;
    const pending = this.ports.page(task?.scope || session.scope, request);
    const value = await (signal ? abortable(pending, signal) : pending);
    if (session.epoch !== epoch || !session.running)
      fail('APP_TASK_ENDED', 'The conversation changed while the App was answering.');
    return value;
  }
  private async surface(session: Session, task?: AppUseTask): Promise<AppSurface> {
    return (await this.page(
      session,
      { action: 'status', ...(task ? { instance: task.instance } : {}) },
      undefined,
      task,
    )) as AppSurface;
  }
  private async authorize(thread: string, task: AppUseTask, action: AppUseAction) {
    const session = await this.session(thread);
    const expiresAt = task.expiresAt;
    task.authorize(
      thread,
      await this.surface(session, task),
      action,
      this.now(),
      !!this.grants.get(this.grantKey(thread, task.scope)),
    );
    if (task.expiresAt !== expiresAt) this.publish(thread);
    return session;
  }
  async input(taskId: string, thread: string) {
    const task = this.tasks.get(taskId);
    if (!task || task.thread !== thread) fail('APP_INPUT_EXPIRED', 'The input task ended.');
    await this.authorize(thread, task, 'semantic.invoke');
  }
  private async executeCall<T>(
    thread: string,
    scope: AppScope | undefined,
    signal: AbortSignal,
    operation: (session: Session, signal: AbortSignal, call: AppUseCall) => Promise<T>,
  ): Promise<T> {
    const session = await this.session(thread);
    const controller = new AbortController();
    const call: AppUseCall = { controller, scope: scope || session.scope };
    const calls = this.calls.get(thread) || new Set<AppUseCall>();
    calls.add(call);
    this.calls.set(thread, calls);
    const bounded = AbortSignal.any([signal, controller.signal]);
    try {
      return await abortable(operation(session, bounded, call), bounded);
    } finally {
      calls.delete(call);
      if (!calls.size) this.calls.delete(thread);
    }
  }
  async access<T>(
    thread: string,
    scope: AppScope | undefined,
    operation: (scope: AppScope | undefined, signal: AbortSignal) => Promise<T>,
    signal: AbortSignal,
  ): Promise<T> {
    return this.executeCall(thread, scope, signal, async (session, bounded) => {
      if (scope && session.scope && (scope.app !== session.scope.app || scope.panel !== session.scope.panel))
        fail('APP_SCOPE_FOREIGN', 'This conversation is scoped to another App.');
      bounded.throwIfAborted();
      await this.session(thread);
      const value = await operation(session.scope, bounded);
      bounded.throwIfAborted();
      await this.session(thread);
      return value;
    });
  }
  async call(
    thread: string,
    value: unknown,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<unknown> {
    const input = parseAppUseRequest(value);
    return this.executeCall(
      thread,
      input.taskId ? this.tasks.get(input.taskId)?.scope : undefined,
      signal,
      (session, bounded, call) => this.perform(thread, input, session, bounded, call),
    );
  }
  private async perform(
    thread: string,
    input: AppUseRequest,
    session: Session,
    signal: AbortSignal,
    call: AppUseCall,
  ): Promise<unknown> {
    signal.throwIfAborted();
    if (input.action === 'inventory') {
      const inventory = (await this.page(session, { action: 'inventory' })) as { surfaces: AppSurface[] };
      return {
        ...inventory,
        fileReferences: this.ports.fileReferences?.(thread) || [],
        actions: ['observe', 'capture', 'semantic.invoke', 'dom.click', 'dom.fill', 'verify'],
        tasks: [...this.tasks.values()]
          .filter((t) => t.thread === thread && !t.ended)
          .map((t) => ({ taskId: t.id, surfaceId: t.surfaceId, actions: t.actions, expiresAt: t.expiresAt })),
        standing: [...this.grants.entries()]
          .filter(([key]) => key.startsWith(thread + '\0'))
          .map(([key, actions]) => ({ app: key.split('\0')[1], panel: key.split('\0')[2], actions })),
      };
    }
    if (input.action === 'start') {
      if (!input.surfaceId || !input.actions?.length)
        fail('APP_USE_INVALID', 'start needs a surfaceId and actions from inventory.');
      for (const t of this.tasks.values())
        if (this.now() >= t.expiresAt && !t.renewable(this.grants.has(this.grantKey(t.thread, t.scope))))
          this.end(t);
      if (this.tasks.size >= 32) fail('APP_TASK_LIMIT', 'Stop another App Use task first.');
      const inventory = (await this.page(session, { action: 'inventory' }, signal)) as {
        surfaces: AppSurface[];
      };
      const before = inventory.surfaces.find((surface) => surface.surfaceId === input.surfaceId);
      if (!before) fail('APP_SURFACE_UNKNOWN', 'Use the surfaceId from inventory.');
      const task = new AppUseTask(
        randomUUID(),
        thread,
        before,
        input.actions,
        input.scope === 'session',
        this.now(),
      );
      if (!reading(task.actions) && !before.operable)
        fail(
          before.capturable ? 'APP_USER_ACTIVE' : 'APP_SURFACE_HIDDEN',
          before.capturable
            ? 'The user is operating this App. Wait for them to finish.'
            : 'Show this App before starting an operation.',
        );
      call.scope = task.scope;
      const key = this.grantKey(thread, task.scope);
      // Reaching this authenticated MCP call means the Agent's approval policy
      // already allowed it. Desktop owns the bounded task, not another prompt.
      signal.throwIfAborted();
      if (task.standing) this.grants.set(key, ['observe', 'capture', 'verify']);
      session.visited.set(key, task.scope);
      this.tasks.set(task.id, task);
      this.publish(thread);
      return {
        taskId: task.id,
        surfaceId: task.surfaceId,
        actions: task.actions,
        expiresAt: task.expiresAt,
        verdict: 'not-run',
      };
    }
    const task = input.taskId ? this.tasks.get(input.taskId) : undefined;
    if (!task || task.thread !== thread || task.ended)
      fail('APP_TASK_REQUIRED', 'Start an App Use task and pass its taskId.');
    if (input.action === 'stop') {
      this.end(task);
      this.publish(thread);
      return {
        taskId: task.id,
        state: 'stopped',
        standing: [...this.grants.entries()]
          .filter(([key]) => key.startsWith(thread + '\0'))
          .map(([key, actions]) => ({ app: key.split('\0')[1], panel: key.split('\0')[2], actions })),
      };
    }
    if (input.action === 'runPlan') return this.runPlan(thread, task, input, signal);
    return this.execute(thread, task, input, signal);
  }
  private async execute(
    thread: string,
    task: AppUseTask,
    input: AppUseRequest,
    signal: AbortSignal,
  ): Promise<unknown> {
    signal.throwIfAborted();
    if (['observe', 'describe'].includes(input.action)) {
      const session = await this.authorize(thread, task, 'observe');
      return this.page(
        session,
        { action: 'observe', instance: task.instance, ...(input.target ? { target: input.target } : {}) },
        signal,
        task,
      );
    }
    if (input.action === 'act') {
      if (!input.command || !input.target || !input.expectedRevisions)
        fail('APP_USE_INVALID', 'act needs command, target and expectedRevisions from observe.');
      const session = await this.authorize(thread, task, input.command);
      let params = input.params || {};
      if (input.command === 'semantic.invoke' && this.ports.resolveFileParameters) {
        const declaration = (await this.page(
          session,
          { action: 'semantic', instance: task.instance, target: input.target },
          signal,
          task,
        )) as { objects: { id: string; commands: { name: string; parameters: unknown }[] }[] };
        const command = declaration.objects
          .find((o) => o.id === input.target)
          ?.commands.find((c) => c.name === input.name);
        if (!command) fail('APP_ACTION_UNKNOWN', 'Observe the declared App command before invoking it.');
        params = await this.ports.resolveFileParameters(task, command.parameters, params);
      }
      const result = await this.page(
        session,
        {
          action: input.command === 'semantic.invoke' ? 'invoke' : input.command,
          instance: task.instance,
          target: input.target,
          name: input.name,
          params,
          expectedRevisions: input.expectedRevisions,
        },
        signal,
        task,
      );
      await this.authorize(thread, task, 'observe');
      return { result, verdict: 'not-run' };
    }
    if (input.action === 'capture') return this.capture(thread, task, input.target, signal);
    if (input.action === 'verify') return this.verify(thread, task, input.check || {}, signal);
    if (input.action === 'wait') {
      const until = input.until;
      if (
        !until ||
        typeof until.target !== 'string' ||
        !(
          (typeof until.key === 'string' && Object.hasOwn(until, 'equals')) ||
          Number.isInteger(until.revisionAfter)
        )
      )
        fail('APP_USE_INVALID', 'wait needs a target and a declared state condition or revisionAfter.');
      const deadline = this.now() + (input.timeoutMs || 10000);
      while (true) {
        signal.throwIfAborted();
        const session = await this.authorize(thread, task, 'observe');
        const snapshot = (await this.page(
          session,
          { action: 'observe', instance: task.instance, target: until.target },
          signal,
          task,
        )) as Snapshot;
        const object = snapshot.objects.find((o) => o.id === until.target);
        if (
          object &&
          (typeof until.key === 'string'
            ? isDeepStrictEqual(object.state[until.key], until.equals)
            : object.revision > (until.revisionAfter as number))
        )
          return { matched: true, snapshot };
        if (this.now() >= deadline)
          fail('APP_WAIT_TIMEOUT', 'The declared App state did not reach the requested condition.');
        await poll(Math.min(150, deadline - this.now()), undefined, { signal });
      }
    }
    fail('APP_USE_INVALID', 'This action cannot run inside a task.');
  }
  private async capture(thread: string, task: AppUseTask, target?: string, signal?: AbortSignal) {
    const session = await this.authorize(thread, task, 'capture');
    if ([...this.evidence.values()].filter((e) => e.taskId === task.id).length >= 16)
      fail('APP_EVIDENCE_LIMIT', 'This task already captured 16 images.');
    const geometry = (await this.page(
      session,
      { action: 'geometry', instance: task.instance, ...(target ? { target } : {}) },
      signal,
      task,
    )) as AppSurface;
    const id = randomUUID();
    const pending = this.ports.capture(geometry.rect, id);
    const image = await (signal ? abortable(pending, signal) : pending);
    await this.authorize(thread, task, 'capture');
    const after = (await this.page(
      session,
      { action: 'geometry', instance: task.instance, ...(target ? { target } : {}) },
      signal,
      task,
    )) as AppSurface;
    if (!isDeepStrictEqual(geometry.rect, after.rect))
      fail('APP_CAPTURE_CHANGED', 'The panel moved while capturing. Capture again.');
    if (!image.png.length || image.png.length > 8 * 1024 * 1024)
      fail('APP_CAPTURE_FAILED', 'The panel capture is empty or too large.');
    const evidence: Evidence = {
      ...image,
      id,
      taskId: task.id,
      target,
      instance: task.instance,
      sha256: createHash('sha256').update(image.png).digest('hex'),
    };
    this.evidence.set(id, evidence);
    const receipt: AppCaptureReceipt = {
      schema: 'pero.app-capture.v1',
      id,
      role: 'app-capture',
      mediaType: 'image/png',
      sha256: evidence.sha256,
      bytes: image.png.length,
      width: image.width,
      height: image.height,
      scope: task.scope,
      surfaceId: task.surfaceId,
      instance: task.instance,
      rect: geometry.rect,
      threadId: thread,
      agentId: session.title,
      taskId: task.id,
      ...(target ? { target } : {}),
      capturedAt: new Date(this.now()).toISOString(),
      ...(image.path ? { path: image.path } : {}),
    };
    await this.ports.recordEvidence?.(receipt);
    return {
      evidence: receipt,
      image: { data: image.png.toString('base64'), mimeType: 'image/png' },
      verdict: 'not-run',
    };
  }

  private async verify(
    thread: string,
    task: AppUseTask,
    check: Record<string, unknown>,
    signal: AbortSignal,
  ) {
    const session = await this.authorize(thread, task, 'verify');
    if (check.kind === 'semantic.equals') {
      if (typeof check.target !== 'string' || typeof check.key !== 'string' || !Object.hasOwn(check, 'value'))
        fail('APP_USE_INVALID', 'semantic.equals needs target, key and value.');
      return this.page(
        session,
        {
          action: 'verify',
          instance: task.instance,
          target: check.target,
          key: check.key,
          equals: check.value,
        },
        signal,
        task,
      );
    }
    if (['text.contains', 'dom.exists'].includes(check.kind as string)) {
      if (!(await this.surface(session, task)).operable)
        return { verdict: 'indeterminate', check, reason: 'Show the panel to verify its rendered content.' };
      const snapshot = (await this.page(
        session,
        { action: 'observe', instance: task.instance },
        signal,
        task,
      )) as Snapshot;
      const passed =
        check.kind === 'text.contains'
          ? typeof check.value === 'string' && !!snapshot.text?.includes(check.value)
          : typeof check.label === 'string' &&
            !!snapshot.dom?.some((r) => r.label === check.label && (!check.role || r.role === check.role));
      const truncated = check.kind === 'text.contains' ? snapshot.textTruncated : snapshot.domTruncated;
      return { verdict: passed ? 'pass' : truncated ? 'indeterminate' : 'fail', check };
    }
    if (['visual.nonblank', 'visual.changed'].includes(check.kind as string)) {
      const target = typeof check.target === 'string' ? check.target : undefined;
      const baseline = typeof check.baseline === 'string' ? this.evidence.get(check.baseline) : undefined;
      if (
        check.kind === 'visual.changed' &&
        (!baseline || baseline.taskId !== task.id || baseline.target !== target)
      )
        fail('APP_BASELINE_INVALID', 'Use a capture from this task and the same target.');
      signal.throwIfAborted();
      const capture = await this.capture(thread, task, target, signal);
      const image = this.evidence.get(capture.evidence.id)!;
      let min = 255,
        max = 0,
        different = 0;
      for (let i = 0; i < image.pixels.length; i += 4) {
        const light = Math.round((image.pixels[i] + image.pixels[i + 1] + image.pixels[i + 2]) / 3);
        min = Math.min(min, light);
        max = Math.max(max, light);
        if (
          baseline &&
          Math.abs(image.pixels[i] - (baseline.pixels[i] ?? -255)) +
            Math.abs(image.pixels[i + 1] - (baseline.pixels[i + 1] ?? -255)) +
            Math.abs(image.pixels[i + 2] - (baseline.pixels[i + 2] ?? -255)) >
            30
        )
          different++;
      }
      const changed =
        !!baseline &&
        (image.width !== baseline.width ||
          image.height !== baseline.height ||
          different / Math.max(1, image.pixels.length / 4) > 0.001);
      return {
        verdict: (check.kind === 'visual.nonblank' ? max - min > 8 : changed) ? 'pass' : 'fail',
        check,
        evidence: capture.evidence,
        note: 'Mechanical pixel check; inspect the image to interpret the result.',
      };
    }
    fail('APP_USE_INVALID', 'Unknown verification check.');
  }
  private async runPlan(thread: string, task: AppUseTask, input: AppUseRequest, signal: AbortSignal) {
    if (!input.steps?.length) fail('APP_USE_INVALID', 'runPlan needs steps.');
    const results = new Map<string, unknown>();
    const steps: { id: string; result?: unknown; error?: string }[] = [];
    const resolve = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(resolve);
      if (!value || typeof value !== 'object') return value;
      const record = value as Record<string, unknown>;
      if (typeof record.$ref === 'string' && Object.keys(record).length === 1) {
        const [id, ...path] = record.$ref.split('.');
        let result = results.get(id);
        for (const key of path) {
          if (!result || typeof result !== 'object' || !Object.hasOwn(result, key))
            fail('APP_PLAN_REFERENCE', 'Plan reference is unavailable.');
          result = (result as Record<string, unknown>)[key];
        }
        if (result === undefined)
          fail('APP_PLAN_REFERENCE', 'Plan references must point to an earlier result.');
        return result;
      }
      return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, resolve(value)]));
    };
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(input.timeoutMs || 60000)]);
    try {
      for (const step of input.steps) {
        bounded.throwIfAborted();
        const request = parseAppUseRequest(resolve(step.request));
        if (!['describe', 'observe', 'capture', 'wait', 'act', 'verify'].includes(request.action))
          fail('APP_USE_INVALID', 'Plans contain only observe, act, wait, capture and verify.');
        const result = await abortable(this.execute(thread, task, request, bounded), bounded);
        bounded.throwIfAborted();
        steps.push({ id: step.id, result });
        results.set(step.id, result);
        if (['fail', 'indeterminate'].includes((result as { verdict?: string })?.verdict || ''))
          return { steps, state: 'failed' };
      }
      return { steps, state: 'completed' };
    } catch (error) {
      steps.push({
        id: input.steps[steps.length]?.id || 'plan',
        error: error instanceof Error ? error.message : String(error),
      });
      return { steps, state: 'failed' };
    } finally {
      this.end(task);
      this.publish(thread);
    }
  }
}
