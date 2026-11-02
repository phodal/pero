import { createAppAgent } from './agent.mjs';
/*
 * Adapted and modified for Pero from KiroCrew website/src/app-sdk at
 * 65b08d3f963cb5b81b5ea7c06047e4dca763c602 (Apache-2.0).
 * See ../NOTICE.md and ../LICENSE-KIROCREW.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  createAppHost,
} from "./core.mjs";
import { createPortal } from "react-dom";
import { normalizeAppLocale, translateAppMessage } from "./i18n.mjs";
import { currentStyleId, currentThemeId, getTheme, subscribeTheme } from "./tokens/themes.mjs";
export { THEMES, STYLES, BASE_STYLE, applyDevStyle, applyStyle, applyTheme, currentStyleId, currentThemeId, subscribeStyle, subscribeTheme, tokenColor, tokenValue } from "./tokens/themes.mjs";

export { createAppI18n, normalizeAppLocale, translateAppMessage } from "./i18n.mjs";
export { downloadFile } from "./download.mjs";
export { Select, type SelectOption, type SelectProps } from './components/select';

export { createAppExamples, readAppExample } from "./examples.mjs";
export interface AppExampleDocument {
  schema: 'pero.app.example.v1'; id: string;
  files: Array<{ name: string; content: string; mediaType: string; sha256: string }>;
  parameters?: Record<string, unknown>;
  source?: Record<string, any>;
}
export interface AppExampleAdapter {
  ready: boolean; empty: boolean; busy: boolean; currentExampleId?: string;
  load(document: AppExampleDocument, context: {requestId: string; signal: AbortSignal}): Promise<void>;
}
export type AppExamples = ReturnType<typeof import('./examples.mjs').createAppExamples>;
export function useAppExamples(adapter: AppExampleAdapter) {
  const bridge = useHost().examples;
  const current = useRef(adapter); current.current = adapter;
  const registration = useRef<ReturnType<AppExamples['register']> | null>(null);
  useEffect(() => {
    if (!bridge) return;
    const value = bridge.register(current.current); registration.current = value;
    return () => { value.dispose(); registration.current = null; };
  }, [bridge]);
  useEffect(() => { registration.current?.update(adapter); });
}

export type AppLocale = "zh" | "en";
export type AppMessages = Record<string, { zh: string; en: string }>;
export type AppMessageVars = Record<string, string | number>;

export function useAppLocale(): AppLocale {
  const locale = useHost().info.locale;
  return normalizeAppLocale(locale ?? (typeof navigator === "undefined" ? "en" : navigator.language));
}

export function useAppI18n(messages: AppMessages): { locale: AppLocale; t: (key: string, vars?: AppMessageVars) => string } {
  const locale = useAppLocale();
  return React.useMemo(() => ({ locale, t: (key: string, vars?: AppMessageVars) => translateAppMessage(messages, locale, key, vars) }), [messages, locale]);
}

export {
  APP_OBJECT_LIMITS,
  AppSurfaceError,
  createAppSurface,
  appObjectProps,
  validateParameters,
} from "./surface.mjs";

export {
  AppApiError,
  checkEventPermission,
  createAppEventHub,
  createAppHost,
  createScopedApi,
  eventPermissionMatches,
  extractSteeringAcks,
  findOptionMarkers,
  hasKeepVisibleMarker,
  normalizeAllowedApiPaths,
  parseOptions,
  scopedApiPath,
  stripKeepVisibleMarker,
  stripOptionMarkers,
} from "./core.mjs";

export interface AppApi {
  readFile(path: string, init?: RequestInit): Promise<ArrayBuffer>;
  request<T = unknown>(path: string, init?: RequestInit): Promise<T>;
  get<T = unknown>(path: string, init?: RequestInit): Promise<T>;
  post<T = unknown>(path: string, body?: unknown, init?: RequestInit): Promise<T>;
  put<T = unknown>(path: string, body?: unknown, init?: RequestInit): Promise<T>;
  patch<T = unknown>(path: string, body?: unknown, init?: RequestInit): Promise<T>;
  del<T = unknown>(path: string, init?: RequestInit): Promise<T>;
}

export interface AppInfo {
  name: string;
  version: string;
  locale: AppLocale;
  permissions: { api: readonly string[]; events: readonly string[]; host: readonly string[] };
  active: boolean;
}

export interface AppTheme {
  mode: "dark" | "light";
  accent: string;
  colorTheme: string;
  /** Registered design-token theme id (pero-light, pero-dark, …); see @pero/app-sdk/themes. */
  id: string;
  /** Registered style pack id (pero-default, compact, comfortable): shape and density, independent of colour. */
  style: string;
}

export type AppChatAttachment =
  | { type: 'app-object'; objectId: string; revision: number; selection?: unknown }
  | { type: 'app-summary'; objectId: string; revision: number };

export interface ChatLaunchOptions {
  /** Transient Host-owned presentation. Wide workbenches reserve a right column;
   * narrow windows retain the floating App Chat. Never creates a second chat. */
  placement?: 'right' | 'floating';
  /** Append a draft/reference without replacing the person's existing input. */
  mode?: 'replace' | 'append';
  /** Explicit references shown as removable composer chips. Cannot be auto-submitted. */
  attachments?: AppChatAttachment[];
  /** Optional frozen screenshot, never auto-sent. Unsupported hosts retain the
   * text/context draft with a notice; Desktop denial or failure rejects it. */
  capture?: boolean;
  /** Open this exact task Session. Without a target, the Workbench reuses the App's own conversation. */
  sessionId?: string;
  message?: string;
  projectId?: string;
  /** Use the Host workspace conversation and its existing file authority. */
  workspaceId?: string;
  /**
   * Send `message` at once instead of leaving it as a draft. Only for a message the person just asked for by
   * clicking in the App (a task they picked); the conversation shows it as theirs and the Agent starts working.
   */
  submit?: boolean;
  /**
   * When false, select the Session for an embedded AppConversation without expanding the
   * floating/docked App Chat. Default true. Embedded pages stay visible; leaving the slot
   * must not leave a floating composer open.
   */
  reveal?: boolean;
  /** Always start a new Project chat instead of reusing the panel's last Project Session. */
  fresh?: boolean;
  /**
   * Agent plugins to select in the composer. The Host appends each available
   * plugin as a chip and does not send or replace existing draft text.
   * A plugin that is missing or still loading stays unselected.
   */
  plugins?: string[];
}

/** Exact existing native Run reference; hostId comes from its Project proof. */
export interface AppProjectRunSessionTarget {
  projectId: string; taskId: string; runId: string; sessionId: string; contextSnapshotId: string; hostId: string;
}
/** Opaque-by-identity, in-memory presentation result. Do not clone, serialize or
 * persist it. This lends no execution authority and contains no controller. */
export interface AppProjectRunConversationSelection extends Readonly<AppProjectRunSessionTarget> {
  readonly schemaVersion: 1; readonly snapshotDigest: string; readonly runtimeGeneration: string;
}

/** A native capability lent by the desktop Host, e.g. `"calendar"`. */
export interface HostCapability {
  call<T = unknown>(operation: string, input?: Record<string, unknown>): Promise<T>;
}

export type AppAgentScope = { workspaceId: string; projectId?: never } | { projectId: string; workspaceId?: never };
export type AppAgentStatus = 'running' | 'needs_input' | 'cancelling' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export interface AppAgentRun { id: string; sessionId: string; scope: AppAgentScope; status: AppAgentStatus; attempt: number; requestId: string; updatedAt: string; error?: string; stopReason?: string; result?: { artifactRef: string; [key: string]: unknown } }
export interface AppAgentRef { runId: string; scope: AppAgentScope }
/** Original start identity plus the latest Host state, which may be a later retry. */
export interface AppAgentLookup { requestId: string; run: AppAgentRun | null }
export interface AppAgent {
  prepare(input: {scope: AppAgentScope; input: Record<string,unknown>}): Promise<Record<string,unknown>>;
  start(input: { scope: AppAgentScope; text: string; requestId?: string; harnessId?: string; context?: Record<string, unknown> }): Promise<AppAgentRun>;
  /** Read-only original-request reconciliation. Null means unresolved, never no effect. */
  lookup(input: { scope: AppAgentScope; requestId: string }): Promise<AppAgentLookup>;
  status(input: AppAgentRef): Promise<AppAgentRun>;
  events(input: AppAgentRef & { after?: number }): Promise<{ run: AppAgentRun; events: Array<{ seq: number; type: string; data: unknown }>; cursor: number }>;
  cancel(input: AppAgentRef): Promise<AppAgentRun>;
  retry(input: AppAgentRef & { requestId?: string; text?: string }): Promise<AppAgentRun>;
  /** Read-only follow of the terminal the Host lent this Run. Omit `terminalId` to list sessions. */
  terminal(input: AppAgentRef & { terminalId?: string; offset?: number; count?: number }): Promise<AppAgentTerminalList | AppAgentTerminalPage>;
}
export interface AppAgentTerminalList { terminals: Array<{ sessionId: string; name?: string; type: string; status: { kind: string; exitCode?: number; signal?: string } }> }
export interface AppAgentTerminalPage { text: string; totalLines: number; lineBegin: number; lineEnd: number; truncated: boolean }

/** Null when the manifest does not declare permissions.host: ["agent"]. */
export function useHostAgent(): AppAgent | null {
  const capability = useHostCapability('agent');
  return React.useMemo(() => createAppAgent(capability), [capability]) as AppAgent | null;
}

export type HostCallFn = (capability: string, operation: string, input: Record<string, unknown>) => Promise<unknown>;

export interface AppHost {
  api: AppApi;
  capability(name: string): HostCapability | null;
  info: AppInfo;
  subscribe(event: string, callback: (value: unknown) => void): () => void;
  navigate(path: string): void | Promise<void>;
  notify(message: string, options?: { type?: "info" | "success" | "error" }): void;
  setBadge(count: number): void;
  launchChat(options?: ChatLaunchOptions): void | Promise<void | string>;
  /** Fresh Project-native proof and local retained-Session selection only. */
  selectProjectRunSession?: (target: AppProjectRunSessionTarget, options?: { signal?: AbortSignal }) => Promise<AppProjectRunConversationSelection>;
  /** Reserve a region for the resident Host conversation; never creates an Agent. */
  mountConversation?: (element: HTMLElement) => () => void;
  /** Reserve the resident conversation only while the Host displays this exact
   * Session. Separate from the legacy slot so older Hosts fail closed. This is
   * presentation binding, not proof of Project membership or execution rights. */
  mountSessionConversation?: (element: HTMLElement, options: { sessionId: string }) => () => void;
  mountProjectRunConversation?: (element: HTMLElement, options: { selection: AppProjectRunConversationSelection; onUnavailable(): void }) => (() => void) | null;
  /** Reserve a region for the Host desktop target picker/display; no execution or credentials are lent. */
  mountDesktop?: (element: HTMLElement, options?: { target?: string }) => () => void;
  examples?: AppExamples | null;
  surface?: AppSurface | null;
}

export interface AppObjectSnapshot {
  id: string; kind: string; label: string; summary?: string; state: unknown; revision: number;
  commands: Array<{ name: string; description?: string; parameters: Record<string, unknown> }>;
}

/** One panel's semantic registry, created by the host (see surface.mjs). */
export interface AppSurface {
  readonly appName: string;
  readonly tabId: string | null;
  readonly revision: number;
  signal(objectId: string): number;
  register(object: AppObject): { update(object: AppObject): void; dispose(): void };
  snapshot(): { revision: number; objects: AppObjectSnapshot[] };
  /** Explicit, read-only composer search. Results carry the observed object revision. */
  searchMentions(query: string, signal: AbortSignal): Promise<Array<AppMention & { objectId: string; revision: number }>>;
  invoke(id: string, name: string, params?: Record<string, unknown>): Promise<unknown>;
  subscribe(listener: (revision: number) => void): () => void;
  dispose(): void;
}

/** One declared action of an App object. `parameters` is the JSON-schema
 * subset `validateParameters` accepts; `run` receives validated parameters. */
export interface AppObjectAction {
  description?: string;
  parameters?: Record<string, unknown>;
  run(params: any): unknown;
}

export interface AppMention {
  label: string;
  description?: string;
  selection: Record<string, unknown>;
}

/** What an App panel declares to an Agent, in the shape Canvas objects use. */
export interface AppObject {
  id: string;
  kind: string;
  label?: string;
  /** Explicit bounded context; never inferred from the full state. */
  summary?: string;
  /** Read-only search over this object's context; never starts work or grants access.
   * Include every identity used by the provider in state so changes invalidate drafts. */
  mentions?: (query: string, signal: AbortSignal) => Promise<AppMention[]>;
  state?: unknown;
  actions?: Record<string, AppObjectAction>;
}

const AppSdkContext = createContext<AppHost | null>(null);

function useHost(): AppHost {
  const host = useContext(AppSdkContext);
  if (!host) throw new Error("Pero App SDK hooks require <AppSdkProvider>");
  return host;
}

export function useAppApi(): AppApi {
  return useHost().api;
}

export function useAppInfo(): AppInfo {
  return useHost().info;
}

export function useAppEvents(event: string, callback: (value: unknown) => void): void {
  const subscribe = useHost().subscribe;
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  useEffect(
    () => subscribe(event, (value) => callbackRef.current(value)),
    [subscribe, event],
  );
}

function readTheme(): AppTheme {
  const root = document.documentElement, id = currentThemeId(document);
  return {
    mode: getTheme(id)?.colorScheme ?? "light",
    id,
    style: currentStyleId(document),
    accent: getComputedStyle(root).getPropertyValue("--accent").trim(),
    colorTheme: root.dataset.colorTheme || "default",
  };
}

export function useTheme(): AppTheme {
  const [theme, setTheme] = useState<AppTheme>(() => readTheme());
  useEffect(() => {
    const refresh = () => setTheme(readTheme());
    const stopTheme = subscribeTheme(refresh, document);
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-color-theme", "data-style", "style"],
    });
    if (document.body) observer.observe(document.body, { attributes: true, attributeFilter: ["data-style", "style"] });
    return () => { stopTheme(); observer.disconnect(); };
  }, []);
  return theme;
}

export function useNavigate(): (path: string) => void | Promise<void> {
  return useHost().navigate;
}

export function useNotify(): AppHost["notify"] {
  return useHost().notify;
}

export function useNavBadge(): (count: number) => void {
  const host = useHost();
  return useCallback((count: number) => host.setBadge(count), [host]);
}

/** The declared host capability (`permissions.host`), or null where the host cannot lend it. */
export function useHostCapability(name: string): HostCapability | null {
  const host = useHost();
  return React.useMemo(() => host.capability(name), [host.capability, name]);
}

export function useChatLauncher(): { openChat(options?: ChatLaunchOptions): void | Promise<void | string>; selectProjectRunSession?: AppHost['selectProjectRunSession']; objectReference(objectId: string, selection?: unknown): AppChatAttachment } {
  const host = useHost();
  return React.useMemo(() => ({ openChat: host.launchChat, selectProjectRunSession: host.selectProjectRunSession,
    objectReference(objectId: string, selection?: unknown): AppChatAttachment {
      const object = host.surface?.snapshot().objects.find(item => item.id === objectId);
      if (!object) throw new Error(`App object ${objectId} is unavailable`);
      return { type: 'app-object', objectId, revision: object.revision, ...(selection === undefined ? {} : { selection }) };
    },
  }), [host]);
}

/**
 * Declare one semantic object of this panel to the host's App Use surface.
 *
 * The object is registered once per id and updated in place on every render,
 * so the Agent always sees the state the user sees and invokes the latest
 * closures. Its revision only moves when the declared values change. Without a
 * host surface (an older host, a simulated one) this does nothing.
 */
export function useAppObject(object: AppObject): void {
  const host = useContext(AppSdkContext);
  const surface = host?.surface ?? null;
  const handle = useRef<ReturnType<AppSurface["register"]> | null>(null);
  const latest = useRef(object);
  latest.current = object;
  useEffect(() => {
    if (!surface) return;
    const registered = surface.register(latest.current);
    handle.current = registered;
    return () => { registered.dispose(); if (handle.current === registered) handle.current = null; };
  }, [surface, object.id]);
  useEffect(() => { handle.current?.update(object); });
}

/** pero.app-result-view.v1 (ADR-0194): the reference an App tool answer carries
 * as `view` so a Host conversation can show the App's own result view. It names
 * App objects by id; it carries no content, verdict or authority. */
export const APP_RESULT_VIEW_SCHEMA = "pero.app-result-view.v1";
export interface AppResultViewRef {
  schema: typeof APP_RESULT_VIEW_SCHEMA;
  /** App-defined, lowercase kebab-case, at most 64 characters. */
  kind: string;
  /** Optional short heading (at most 120 characters). */
  title?: string;
  [reference: string]: unknown;
}
/** Props of the named `ToolResultView` export of an App's panel module. The Host
 * renders it under the App's own API permissions and the conversation Session;
 * it has no host capabilities, App Use surface or chat launcher. */
export interface AppToolResultViewProps {
  /** Owning conversation, for a presentation-only return link. */
  sessionId?: string;
  /** The declared agent tool whose answer named the view. */
  tool: string;
  view: AppResultViewRef;
  /** Reveal this App's panel, e.g. after asking it to show a detail page. */
  openPanel(): void;
}

/** A layout slot for the Host's ordinary Session, including its composer.
 * The Host keeps the resident React tree and execution authority. */
export function AppConversation({ active = true, className, fallback }: { active?: boolean; className?: string; fallback?: ReactNode }) {
  const host = useHost();
  const element = useRef<HTMLDivElement>(null);
  const mount = host.mountConversation;
  // Layout effect registers the slot before paint so openChat cannot flash a floating composer.
  useLayoutEffect(() => {
    if (!host.info.active || !active || !mount || !element.current) return;
    return mount(element.current);
  }, [mount, host.info.active, active]);
  return <div ref={element} className={className} data-pero-app-conversation="">{!mount ? fallback : null}</div>;
}

/** The same resident Host tree, bound to an expected Session. Does not open a
 * Session or start an Agent. A Host without this binding contract renders only
 * the fallback; it must never fall back to the unbound AppConversation slot. */
export function AppSessionConversation({ sessionId, active = true, className, fallback }: { sessionId: string; active?: boolean; className?: string; fallback?: ReactNode }) {
  const host = useHost();
  const element = useRef<HTMLDivElement>(null);
  const mount = host.mountSessionConversation;
  const supported = !!mount && typeof sessionId === 'string' && !!sessionId.trim();
  useLayoutEffect(() => {
    if (!host.info.active || !active || !supported || !mount || !element.current) return;
    return mount(element.current, { sessionId });
  }, [mount, host.info.active, active, supported, sessionId]);
  return <div ref={element} className={className} data-pero-app-session-conversation="">{!supported ? fallback : null}</div>;
}

/** Task-labelled presentation requires the exact result issued to this App by
 * selectProjectRunSession. Older Hosts and revoked/foreign results fail closed. */
export function AppProjectRunConversation({ selection, active = true, className, fallback, onUnavailable }: {
  selection: AppProjectRunConversationSelection; active?: boolean; className?: string; fallback?: ReactNode; onUnavailable?: () => void;
}) {
  const host = useHost(), mount = host.mountProjectRunConversation;
  const element = useRef<HTMLDivElement>(null), unavailable = useRef(onUnavailable);
  const currentSelection = useRef(selection); currentSelection.current = selection;
  unavailable.current = onUnavailable;
  const [closed, setClosed] = useState(false);
  useLayoutEffect(() => {
    if (!host.info.active || !active || !mount || !element.current) return;
    setClosed(false);
    let live = true;
    const close = () => { if (live && currentSelection.current === selection) { setClosed(true); unavailable.current?.(); } };
    const release = mount(element.current, { selection, onUnavailable: close });
    if (!release) { close(); return; }
    return () => { live = false; release(); };
  }, [mount, host.info.active, active, selection]);
  return <div ref={element} className={className} data-pero-app-project-run-conversation="">{!mount || closed ? fallback : null}</div>;
}

/** Embed the Host's existing desktop surface inside an App. The Host retains
 * target selection, lifecycle, credentials, control leases and human takeover. */
export function AppDesktop({ active = true, className, fallback, target }: { active?: boolean; className?: string; fallback?: ReactNode; target?: string }) {
  const host = useHost();
  const element = useRef<HTMLDivElement>(null);
  const mount = host.mountDesktop;
  useLayoutEffect(() => {
    if (!host.info.active || !active || !mount || !element.current) return;
    return mount(element.current, target ? { target } : undefined);
  }, [mount, host.info.active, active, target]);
  return <div ref={element} className={className} data-pero-app-desktop="">{!mount ? fallback : null}</div>;
}

const AppTitlebarContext = createContext<HTMLElement | null>(null);

export function AppSdkProvider({ host, titlebar = null, children }: { host: AppHost; titlebar?: HTMLElement | null; children: ReactNode }) {
  return React.createElement(AppSdkContext.Provider, { value: host }, React.createElement(AppTitlebarContext.Provider, { value: titlebar }, children));
}

/** Renders its children in the shell's titlebar action slot while the App is active. Without a slot (standalone host)
 * it renders them in place, so the App still works. */
export function AppTitlebar({ children }: { children: ReactNode }) {
  const slot = useContext(AppTitlebarContext), active = useAppInfo().active;
  if (!slot) return React.createElement(React.Fragment, null, children);
  return active ? createPortal(children, slot) : null;
}

export function AppApiProvider({
  appName,
  appVersion = "0.0.0",
  locale = typeof navigator === "undefined" ? "en" : navigator.language,
  allowedApiPaths,
  allowedEvents,
  active = true,
  fetch,
  hostHeaders,
  subscribeFn,
  navigateFn,
  notifyFn,
  setBadgeFn,
  launchChatFn,
  selectProjectRunSessionFn,
  mountConversationFn,
  mountSessionConversationFn,
  mountProjectRunConversationFn,
  mountDesktopFn,
  surface,
  examples,
  allowedHostCapabilities = [],
  hostCallFn,
  titlebar,
  children,
}: {
  appName: string;
  appVersion?: string;
  locale?: string;
  allowedApiPaths: string[];
  allowedEvents: string[];
  active?: boolean;
  fetch?: typeof globalThis.fetch;
  hostHeaders?: HeadersInit;
  subscribeFn: AppHost["subscribe"];
  navigateFn: AppHost["navigate"];
  notifyFn: AppHost["notify"];
  setBadgeFn?: AppHost["setBadge"];
  launchChatFn?: AppHost["launchChat"];
  selectProjectRunSessionFn?: AppHost['selectProjectRunSession'];
  mountConversationFn?: AppHost["mountConversation"];
  mountSessionConversationFn?: AppHost["mountSessionConversation"];
  mountProjectRunConversationFn?: AppHost['mountProjectRunConversation'];
  mountDesktopFn?: AppHost["mountDesktop"];
  examples?: AppExamples | null;
  surface?: AppSurface | null;
  allowedHostCapabilities?: string[];
  hostCallFn?: HostCallFn;
  titlebar?: HTMLElement | null;
  children: ReactNode;
}) {
  const apiKey = JSON.stringify(allowedApiPaths);
  const hostKey = JSON.stringify(allowedHostCapabilities);
  const eventKey = JSON.stringify(allowedEvents);
  const headersKey = JSON.stringify([...new Headers(hostHeaders).entries()]);
  // Presentation changes must not restart Apps' API/capability effects. Keep
  // those interfaces tied to their actual permission, Session and Host scope.
  const authority = React.useMemo(
    () => createAppHost({ name: appName, allowedApiPaths, allowedHostCapabilities, fetch, hostHeaders, hostCall: hostCallFn }),
    // Content, not object identity, defines headers and manifest permissions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appName, apiKey, hostKey, headersKey, fetch, hostCallFn],
  );
  const host = React.useMemo(
    () => Object.freeze({ ...createAppHost({
      name: appName,
      version: appVersion,
      locale,
      allowedApiPaths,
      allowedEvents,
      active,
      fetch,
      hostHeaders,
      subscribe: subscribeFn,
      navigate: navigateFn,
      notify: notifyFn,
      setBadge: setBadgeFn,
      launchChat: launchChatFn,
      surface: surface ?? null,
      examples: examples ?? null,
      allowedHostCapabilities,
      hostCall: hostCallFn,
    }), api: authority.api, capability: authority.capability, selectProjectRunSession: selectProjectRunSessionFn, mountConversation: mountConversationFn, mountSessionConversation: mountSessionConversationFn, mountProjectRunConversation: mountProjectRunConversationFn, mountDesktop: mountDesktopFn }) as AppHost,
    // Array content, not caller identity, defines the permission boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appName, appVersion, locale, apiKey, eventKey, hostKey, active, fetch, hostHeaders, subscribeFn, navigateFn, notifyFn, setBadgeFn, launchChatFn, selectProjectRunSessionFn, mountConversationFn, mountSessionConversationFn, mountProjectRunConversationFn, surface, examples, hostCallFn, mountDesktopFn, authority],
  );
  // Keep the existing permission-checked wrapper while its actual event scope
  // is unchanged. Presentation callbacks can change on every Host render; they
  // must not detach/replay subscriptions (some carriers publish on subscribe).
  const subscribe = React.useMemo(
    () => host.subscribe,
    // These are the inputs of that wrapper plus the provider's scope/lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appName, eventKey, headersKey, subscribeFn, active],
  );
  const providerHost = React.useMemo(() => Object.freeze({ ...host, subscribe }), [host, subscribe]);
  return React.createElement(AppSdkProvider, { host: providerHost, titlebar, children });
}
