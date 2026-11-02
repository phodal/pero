// Theme registry and runtime API. A theme is selected by data-theme on <html> (or any
// subtree root); the generated stylesheet maps it to tokens. data-color-scheme mirrors the
// theme's declared scheme so code that only cares about light/dark can read one attribute.
import { THEMES, BASE_THEME, SYSTEM_THEMES, STYLES, BASE_STYLE } from "./themes-index.mjs";

export { THEMES, BASE_THEME, STYLES, BASE_STYLE };
const byId = new Map(THEMES.map((t) => [t.id, t]));
const ALIASES = { light: "pero-light", dark: "pero-dark" };

export function getTheme(id) { return byId.get(ALIASES[id] ?? id); }

/** The content theme: an explicit body theme overrides html; only explicit system roots follow the OS. */
export function currentThemeId(doc = globalThis.document) {
  const root = doc?.documentElement, body = doc?.body;
  const rootTheme = root?.getAttribute?.("data-theme"), bodyTheme = body?.getAttribute?.("data-theme");
  for (const attr of [bodyTheme, rootTheme]) {
    if (attr === "system") {
      const dark = doc?.defaultView?.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
      return SYSTEM_THEMES[dark ? "dark" : "light"] ?? BASE_THEME;
    }
    if (attr && getTheme(attr)) return getTheme(attr).id;
  }
  // Keep the host-owned mode: no attribute does not opt the document into OS tracking.
  // These guards match the generated legacy dark-marker selector, including unknown attributes.
  if (rootTheme == null && bodyTheme == null && body?.hasAttribute?.("data-ds-dark-theme")) return "pero-dark";
  return BASE_THEME;
}

export function currentColorScheme(doc = globalThis.document) {
  return getTheme(currentThemeId(doc))?.colorScheme ?? "light";
}

/** Select a registered html theme. "system"/null retains the legacy reset-to-host behavior:
 * remove the html override without changing the host's body theme/dark marker.
 * Standalone documents opt into OS following with data-theme="system" on html or body.
 */
export function applyTheme(id, doc = globalThis.document) {
  const root = doc.documentElement;
  if (id == null || id === "system") { root.removeAttribute("data-theme"); root.removeAttribute("data-color-scheme"); return currentThemeId(doc); }
  const theme = getTheme(id);
  if (!theme) throw new Error(`unknown theme ${id}`);
  root.setAttribute("data-theme", theme.id);
  root.setAttribute("data-color-scheme", theme.colorScheme);
  // Keep the upstream DSH dark marker in step, so app CSS keyed on body[data-ds-dark-theme]
  // takes its dark branch for every dark theme (pero-dark, pero-high-contrast, ...).
  if (doc.body) doc.body.toggleAttribute("data-ds-dark-theme", theme.colorScheme === "dark");
  return theme.id;
}

/** Calls back with the theme id whenever the host or the user switches theme. Returns unsubscribe. */
export function subscribeTheme(callback, doc = globalThis.document) {
  let last = currentThemeId(doc);
  const check = () => { const next = currentThemeId(doc); if (next !== last) { last = next; callback(next); } };
  const Observer = doc?.defaultView?.MutationObserver ?? globalThis.MutationObserver;
  const observer = Observer ? new Observer(check) : null;
  if (doc?.documentElement) observer?.observe(doc.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-color-scheme"] });
  if (doc?.body) observer?.observe(doc.body, { attributes: true, attributeFilter: ["data-ds-dark-theme", "data-theme"] });
  const media = doc?.defaultView?.matchMedia?.("(prefers-color-scheme: dark)");
  if (media?.addEventListener) media.addEventListener("change", check);
  else media?.addListener?.(check);
  return () => {
    observer?.disconnect();
    if (media?.removeEventListener) media.removeEventListener("change", check);
    else media?.removeListener?.(check);
  };
}

/** Concrete colour of a token for canvas/WebGL drawing (CSS variables do not reach a 2D context). */
export function tokenColor(name, fallback = "", element = globalThis.document?.body ?? globalThis.document?.documentElement) {
  try { return getComputedStyle(element).getPropertyValue(`--pero-${name}`).trim() || fallback; } catch { return fallback; }
}

// Styles: shape/density packs selected by data-style on <html> (or any subtree root). They are a
// second, independent dimension: any style composes with any theme.
const styleById = new Map(STYLES.map((s) => [s.id, s]));
export function getStyle(id) { return styleById.get(id); }

/** The document's content style: body overrides html, matching the generated CSS cascade. */
export function currentStyleId(doc = globalThis.document) {
  const attr = doc?.body?.getAttribute?.("data-style") ?? doc?.documentElement?.getAttribute?.("data-style");
  return attr && styleById.has(attr) ? attr : BASE_STYLE;
}

/** Select a registered style; null or the base style removes the override. */
export function applyStyle(id, doc = globalThis.document) {
  const root = doc.documentElement;
  if (id == null || id === BASE_STYLE) { root.removeAttribute("data-style"); doc.body?.removeAttribute("data-style"); return BASE_STYLE; }
  if (!styleById.has(id)) throw new Error(`unknown style ${id}`);
  root.setAttribute("data-style", id);
  doc.body?.removeAttribute("data-style");
  return id;
}

/** Calls back with the style id whenever the host or the user switches style. Returns unsubscribe. */
export function subscribeStyle(callback, doc = globalThis.document) {
  let last = currentStyleId(doc);
  const check = () => { const next = currentStyleId(doc); if (next !== last) { last = next; callback(next); } };
  const Observer = doc?.defaultView?.MutationObserver ?? globalThis.MutationObserver;
  if (!Observer) return () => {};
  const observer = new Observer(check);
  observer.observe(doc.documentElement, { attributes: true, attributeFilter: ["data-style"] });
  if (doc.body) observer.observe(doc.body, { attributes: true, attributeFilter: ["data-style"] });
  return () => observer.disconnect();
}

/**
 * Development switch (no settings UI yet): `?pero-style=<id>` in the page URL, else
 * localStorage["pero.dev.style"]. Applied only when the host has not set a style itself.
 */
export function applyDevStyle(doc = globalThis.document) {
  try {
    if (!doc?.documentElement || doc.documentElement.hasAttribute("data-style") || doc.body?.hasAttribute("data-style")) return null;
    const win = doc.defaultView ?? globalThis;
    const id = new URL(win.location.href).searchParams.get("pero-style") ?? win.localStorage?.getItem("pero.dev.style");
    return id && styleById.has(id) ? applyStyle(id, doc) : null;
  } catch { return null; }
}

/** Concrete value of a dimension token (px/ms string) for canvas drawing. */
export function tokenValue(name, fallback = "", element = globalThis.document?.body ?? globalThis.document?.documentElement) {
  try { return getComputedStyle(element).getPropertyValue(`--pero-${name}`).trim() || fallback; } catch { return fallback; }
}
