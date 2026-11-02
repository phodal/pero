import * as React from "react";
import * as ReactJSXRuntime from "react/jsx-runtime";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import * as sdk from "./index";
import * as chart from "./chart/index";
import * as ui from "./ui";
export * from "./index";

export const PERO_APP_SDK_MODULE_ID = "@pero/app-sdk";
/** The native chart for App panels (see chart/index.tsx), shared like the SDK itself. */
export const PERO_APP_SDK_CHART_MODULE_ID = "@pero/app-sdk/chart";
export const PERO_APP_SDK_UI_MODULE_ID = "@pero/app-sdk/ui";
/**
 * The host React runtime, published under the specifier a same-document App
 * imports.
 *
 * An App panel is rendered by the host's own React tree. An App that imported
 * its own copy would build elements the host cannot reconcile — hooks would
 * throw, and provider context would never reach it — so "the App and the host
 * share one React" has to be a fact this module establishes, not a convention
 * an App is asked to honour. The namespace registered here is this module's own
 * React, so the App's registry read and the host's `import React` are the same
 * object.
 */
export const PERO_REACT_MODULE_ID = "react";
export const PERO_REACT_JSX_RUNTIME_MODULE_ID = "react/jsx-runtime";
/** `createPortal`/`flushSync` must come from the ReactDOM that owns the tree. */
export const PERO_REACT_DOM_MODULE_ID = "react-dom";
export const PERO_REACT_DOM_CLIENT_MODULE_ID = "react-dom/client";
export const inject: string[] = [];

/**
 * DSH's client-module catalog applies every application entry as a plugin.
 * Registry installation is an eager module side effect (below), so there is
 * no runtime service to mount here; the explicit no-op makes that catalog
 * contract honest without creating a second SDK/provider instance.
 */
export function apply(): void {}

type SharedModules = Record<string, unknown>;
type PointGlobal = typeof globalThis & { __pero_modules?: SharedModules };

/**
 * Claim one registry entry for this build.
 *
 * The collision rule is the point: a *different* runtime claiming the same
 * specifier is a broken deployment, not a later registration that wins. An
 * identical namespace is idempotent, because the host may evaluate this module
 * twice in one page (a re-import, a second bundle graph); anything else is
 * refused loudly, before an App renders against a React that is not the one
 * holding its tree.
 */
function claim(target: PointGlobal, id: string, value: unknown): () => void {
  const modules = target.__pero_modules ?? (target.__pero_modules = {});
  const previous = modules[id];
  if (previous && previous !== value)
    throw new Error(`${id} is already registered by another host`);
  modules[id] = value;
  return () => {
    if (modules[id] === value) {
      if (previous) modules[id] = previous;
      else delete modules[id];
    }
  };
}

export function installPeroAppSdk(target: PointGlobal = globalThis as PointGlobal): () => void {
  const releaseReact = claim(target, PERO_REACT_MODULE_ID, React);
  const releaseJSX = claim(target, PERO_REACT_JSX_RUNTIME_MODULE_ID, ReactJSXRuntime);
  const releaseDOM = claim(target, PERO_REACT_DOM_CLIENT_MODULE_ID, ReactDOMClient);
  let releasePortal = () => {};
  try {
    releasePortal = claim(target, PERO_REACT_DOM_MODULE_ID, ReactDOM);
    const releaseSDK = claim(target, PERO_APP_SDK_MODULE_ID, sdk);
    let releaseChart: () => void;
    try { releaseChart = claim(target, PERO_APP_SDK_CHART_MODULE_ID, chart); }
    catch (error) { releaseSDK(); throw error; }
    let releaseUI: () => void;
    try { releaseUI = claim(target, PERO_APP_SDK_UI_MODULE_ID, ui); }
    catch (error) { releaseChart(); releaseSDK(); throw error; }
    return () => { releaseUI(); releaseChart(); releaseSDK(); releasePortal(); releaseDOM(); releaseJSX(); releaseReact(); };
  } catch (error) {
    // The SDK entry is what this module exists for. A refused SDK claim must
    // not leave behind a React namespace this call installed, or the next
    // attempt would collide with this one's leftovers.
    releasePortal();
    releaseDOM();
    releaseJSX();
    releaseReact();
    throw error;
  }
}

// The static DSH frontend evaluates every built-in client module before boot.
// Same-document apps can therefore consume the SDK through the module loader or
// through this stable registry without bundling a second React runtime.
installPeroAppSdk();

// Source compatibility names; the registry still contains only Pero implementations.
export { installPeroAppSdk as installPointAppSdk };
export const POINT_APP_SDK_MODULE_ID = PERO_APP_SDK_MODULE_ID;
export const POINT_APP_SDK_CHART_MODULE_ID = PERO_APP_SDK_CHART_MODULE_ID;
export const POINT_APP_SDK_UI_MODULE_ID = PERO_APP_SDK_UI_MODULE_ID;
export const POINT_REACT_MODULE_ID = PERO_REACT_MODULE_ID;
export const POINT_REACT_JSX_RUNTIME_MODULE_ID = PERO_REACT_JSX_RUNTIME_MODULE_ID;
export const POINT_REACT_DOM_MODULE_ID = PERO_REACT_DOM_MODULE_ID;
export const POINT_REACT_DOM_CLIENT_MODULE_ID = PERO_REACT_DOM_CLIENT_MODULE_ID;
