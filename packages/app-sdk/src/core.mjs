/*
 * Adapted and modified for Pero from KiroCrew website/src/app-sdk at
 * 65b08d3f963cb5b81b5ea7c06047e4dca763c602 (Apache-2.0).
 * See ../NOTICE.md and ../LICENSE-KIROCREW.
 */
import { normalizeAppLocale } from './i18n.mjs';
const LOCAL_ORIGIN = "http://pero.invalid";

export class AppApiError extends Error {
  constructor(status, body) {
    super(`API ${status}: ${body}`);
    this.name = "AppApiError";
    this.status = status;
    this.body = body;
  }
}

function localPath(path, label = "path") {
  if (typeof path !== "string" || path.length === 0)
    throw new TypeError(`${label} must be a non-empty string`);
  if (/^(?:[a-z][a-z\d+.-]*:)?[/\\]{2}/i.test(path) || path.includes("\\"))
    throw new Error(`[pero-app-sdk] Absolute URLs are not allowed: ${path}`);
  const parsed = new URL(path, LOCAL_ORIGIN);
  if (parsed.origin !== LOCAL_ORIGIN)
    throw new Error(`[pero-app-sdk] Absolute URLs are not allowed: ${path}`);
  return { pathname: parsed.pathname, search: parsed.search };
}

export function normalizeAllowedApiPaths(paths) {
  if (!Array.isArray(paths)) throw new TypeError("allowedApiPaths must be an array");
  return Object.freeze(paths.map((path, index) => {
    const { pathname, search } = localPath(path, `allowedApiPaths[${index}]`);
    if (search) throw new Error("API permission paths cannot contain a query");
    return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  }));
}

export function scopedApiPath(path, allowedApiPaths, appName = "app") {
  const { pathname, search } = localPath(path);
  const allowed = allowedApiPaths.some(
    (prefix) => prefix === "/" || pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (!allowed) {
    throw new Error(
      `[pero-app-sdk] App "${appName}" cannot access ${pathname}. Declared: [${allowedApiPaths.join(", ")}]`,
    );
  }
  return pathname + search;
}

/**
 * Build a JSON client whose URL and authority-bearing headers are host-owned.
 * `hostHeaders` always wins over caller input, preventing an app from choosing
 * another Session or capability lease by replacing a trusted header.
 */
export function createScopedApi({
  appName,
  allowedApiPaths,
  fetch: fetchImpl = globalThis.fetch,
  hostHeaders = {},
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetch is unavailable");
  const paths = normalizeAllowedApiPaths(allowedApiPaths ?? []);
  const fixedHeaders = new Headers(hostHeaders);

  const jsonFetch = async (path, init = {}) => {
    const safePath = scopedApiPath(path, paths, appName);
    const headers = new Headers(init.headers);
    fixedHeaders.forEach((value, name) => headers.set(name, value));
    const response = await fetchImpl(safePath, { ...init, headers });
    if (!response.ok) {
      const body = await response.text().catch(() => response.statusText);
      throw new AppApiError(response.status, body);
    }
    if (response.status === 204 || response.status === 205) return undefined;
    const text = await response.text();
    return text.trim() === "" ? undefined : JSON.parse(text);
  };

  const jsonRequest = (path, method, body, init = {}) => {
    const headers = new Headers(init.headers);
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    return jsonFetch(path, {
      ...init,
      method,
      headers,
      body: body == null ? undefined : JSON.stringify(body),
    });
  };

  return Object.freeze({
    request: jsonFetch,
    async readFile(path, init = {}) {
      const safePath = scopedApiPath(path, paths, appName);
      // Explicit input grants are the only binary host surface exposed here.
      const prefix = `/api/apps/${appName}/inputs/`;
      if (!safePath.startsWith(prefix) || !/^[a-f0-9]{64}$/.test(safePath.slice(prefix.length))) throw new Error('Invalid App input URL');
      const headers = new Headers(init.headers);
      fixedHeaders.forEach((value, name) => headers.set(name, value));
      const response = await fetchImpl(safePath, { ...init, method: 'GET', headers, redirect: 'error' });
      if (!response.ok) throw new AppApiError(response.status, 'App input unavailable');
      const reader = response.body?.getReader();
      if (!reader) throw new Error('App input body unavailable');
      const chunks = []; let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 32 * 1024 * 1024) throw new Error('App input exceeds 32 MiB');
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return bytes.buffer;
    },
    get: (path, init) => jsonFetch(path, { ...init, method: "GET" }),
    post: (path, body, init) => jsonRequest(path, "POST", body, init),
    put: (path, body, init) => jsonRequest(path, "PUT", body, init),
    patch: (path, body, init) => jsonRequest(path, "PATCH", body, init),
    del: (path, init) => jsonFetch(path, { ...init, method: "DELETE" }),
  });
}

export function eventPermissionMatches(event, permission) {
  if (permission === "*") return true;
  if (permission === event) return true;
  return permission.endsWith(":*") && event.startsWith(permission.slice(0, -1));
}

export function checkEventPermission(event, allowedEvents) {
  if (typeof event !== "string" || event.length === 0)
    return { allowed: false, reason: "Event name must be a non-empty string." };
  const permission = (allowedEvents ?? []).find((entry) => eventPermissionMatches(event, entry));
  return permission
    ? { allowed: true, permission }
    : { allowed: false, reason: `Event "${event}" is not declared.` };
}

export function createAppEventHub() {
  const listeners = new Map();
  return Object.freeze({
    subscribe(event, callback) {
      if (typeof callback !== "function") throw new TypeError("callback must be a function");
      const set = listeners.get(event) ?? new Set();
      set.add(callback);
      listeners.set(event, set);
      return () => {
        set.delete(callback);
        if (set.size === 0) listeners.delete(event);
      };
    },
    emit(event, value) {
      for (const callback of [...(listeners.get(event) ?? [])]) callback(value);
    },
    clear() {
      listeners.clear();
    },
  });
}

export function createAppHost({
  name,
  version = "0.0.0",
  locale = "en",
  allowedApiPaths = [],
  allowedEvents = [],
  active = true,
  fetch,
  hostHeaders,
  subscribe,
  navigate = () => {},
  notify = () => {},
  setBadge = () => {},
  launchChat = () => {},
  surface = null,
  examples = null,
  allowedHostCapabilities = [],
  hostCall,
} = {}) {
  if (typeof name !== "string" || name.length === 0) throw new TypeError("name is required");
  const eventPermissions = Object.freeze([...allowedEvents]);
  const hostPermissions = Object.freeze([...new Set(allowedHostCapabilities.filter(item => typeof item === "string" && item))]);
  const rawSubscribe = subscribe ?? createAppEventHub().subscribe;
  return Object.freeze({
    api: createScopedApi({ appName: name, allowedApiPaths, fetch, hostHeaders }),
    info: Object.freeze({
      name,
      version,
      locale: normalizeAppLocale(locale),
      permissions: Object.freeze({
        api: normalizeAllowedApiPaths(allowedApiPaths),
        events: eventPermissions,
        host: hostPermissions,
      }),
      active,
    }),
    // A native capability the desktop Host lends this App (for example the
    // read-only calendar). Null when the manifest did not declare it or this
    // host cannot provide it, so an App can render its own "unavailable" state.
    capability(capabilityName) {
      if (!hostPermissions.includes(capabilityName) || typeof hostCall !== "function") return null;
      return Object.freeze({
        call: (operation, input = {}) => hostCall(capabilityName, operation, input),
      });
    },
    subscribe(event, callback) {
      const check = checkEventPermission(event, eventPermissions);
      if (!check.allowed) throw new Error(`[pero-app-sdk] ${check.reason}`);
      return rawSubscribe(event, callback);
    },
    navigate,
    notify,
    setBadge,
    launchChat,
    // The panel's semantic registry (see surface.mjs). Null when the host
    // offers no App Use surface; `useAppObject` is then a no-op, so an App
    // that declares objects still renders under an older or simulated host.
    surface,
    examples,
  });
}

const OPTION_HEAD_RE = /([\[\u3010\uFF3B\u3014])OPTION(S)?:/gi;
const OPENERS = "[\u3010\uFF3B\u3014";
const CLOSERS = "]\u3011\uFF3D\u3015";

function hasUnmatchedOpener(labels) {
  const stack = [];
  for (const character of labels) {
    const opener = OPENERS.indexOf(character);
    if (opener >= 0) stack.push(opener);
    const closer = CLOSERS.indexOf(character);
    if (closer >= 0 && stack.at(-1) === closer) stack.pop();
  }
  return stack.length > 0;
}

function markerOnLine(line) {
  const matches = [...line.matchAll(new RegExp(OPTION_HEAD_RE))];
  for (let index = matches.length - 1; index >= 0; index--) {
    const match = matches[index];
    const openerIndex = OPENERS.indexOf(match[1]);
    const closer = CLOSERS[openerIndex];
    let tail = line.slice(match.index + match[0].length);
    const suffix = tail.match(/(?:\([^\s()]*\))?([`*_]{0,3})[ \t]*$/);
    if (!suffix) continue;
    const end = tail.length - suffix[0].length;
    const closeIndex = tail.lastIndexOf(closer, end);
    if (closeIndex < 0 || tail.slice(closeIndex + 1, end).trim() !== "") continue;
    const labels = tail.slice(0, closeIndex);
    if (hasUnmatchedOpener(labels)) continue;
    const before = line.slice(0, match.index);
    const leadingWrapper = before.match(/[`*_]{1,3}$/)?.[0] ?? "";
    if (suffix[1] && suffix[1] !== leadingWrapper) continue;
    return {
      start: match.index - leadingWrapper.length,
      end: line.length,
      labels,
      multi: Boolean(match[2]),
    };
  }
  return null;
}

export function findOptionMarkers(content) {
  const markers = [];
  let offset = 0;
  for (const line of String(content).split("\n")) {
    const marker = markerOnLine(line);
    if (marker) markers.push({ ...marker, start: marker.start + offset, end: marker.end + offset });
    offset += line.length + 1;
  }
  return markers;
}

export function stripOptionMarkers(content) {
  const value = String(content);
  const markers = findOptionMarkers(value);
  let cursor = 0;
  return markers.map((marker) => {
    const prefix = value.slice(cursor, marker.start);
    cursor = marker.end;
    return prefix;
  }).join("") + value.slice(cursor);
}

export function parseOptions(content) {
  const value = String(content);
  const markers = findOptionMarkers(value);
  const marker = markers.at(-1);
  if (!marker) return { text: value, options: [], multi: true, isPlan: false };
  const separator = marker.labels.includes("|") ? "|" : ",";
  const options = marker.labels.split(separator).map((item) => item.trim()).filter(Boolean);
  return {
    text: stripOptionMarkers(value).trim(),
    options,
    multi: marker.multi,
    isPlan: /📋\s*Plan for:/i.test(value) && /^Stage\s+\d+\s*:/m.test(value),
  };
}

const STEERING_RE = /\[STEERING\s+steer-[^\]:]+:\s*([\s\S]*?)\]/g;
export function extractSteeringAcks(content) {
  const acks = [];
  const cleaned = String(content).replace(STEERING_RE, (_match, summary) => {
    const value = String(summary).trim();
    if (value) acks.push(value);
    return "";
  });
  return { cleaned: cleaned.replace(/\n{3,}/g, "\n\n").trimEnd(), acks };
}

const KEEP_VISIBLE_RE = /(?:^|\n)[ \t]{0,3}<!--\s{0,16}keep-visible\s{0,16}-->[ \t]{0,16}(?:\n[ \t]{0,3}<!--\s{0,16}(?:deliver|plan_task_id):[^>\n]{0,256}-->[ \t]{0,16})*\s{0,16}$/i;

function tailIsInsideFence(text, index) {
  let fence = null;
  for (const line of text.slice(0, index).split("\n")) {
    const match = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!match) continue;
    if (!fence) fence = match[1];
    else if (match[1][0] === fence[0] && match[1].length >= fence.length && match[2].trim() === "") fence = null;
  }
  return fence !== null;
}

export function stripKeepVisibleMarker(content) {
  const text = String(content);
  const match = KEEP_VISIBLE_RE.exec(text);
  if (!match || tailIsInsideFence(text, match.index)) return text;
  return text.slice(0, match.index);
}

export function hasKeepVisibleMarker(content) {
  return stripKeepVisibleMarker(content) !== String(content);
}
