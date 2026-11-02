import { TOKENS_CSS } from "./tokens-css.mjs";
import { applyDevStyle } from "./themes.mjs";

/**
 * SDK components draw with --pero-* tokens. The Go Workbench imports tokens.css;
 * other SDK hosts (Force Desktop, standalone App pages) may not, and an undefined
 * custom property makes a whole declaration invalid (a transparent dialog). Inject
 * the generated stylesheet once, first in <head> so a host's own CSS still wins.
 */
export function ensureDesignTokens(doc) {
  applyDevStyle(doc); // development style switch (?pero-style= / localStorage), no-op otherwise
  if (!doc?.head || doc.getElementById("pero-design-tokens")) return false;
  try {
    const view = doc.defaultView;
    if (view?.getComputedStyle && view.getComputedStyle(doc.documentElement).getPropertyValue("--pero-tokens").trim()) return false;
  } catch { /* no computed style: inject */ }
  const style = doc.createElement("style");
  style.id = "pero-design-tokens";
  style.textContent = TOKENS_CSS;
  doc.head.prepend(style);
  return true;
}
