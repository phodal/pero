// Upstream attribution and license: packages/app-sdk/NOTICE.md.
import * as React from 'react';
import * as JSX from 'react/jsx-runtime';
import * as ReactDOM from 'react-dom';
import * as ReactDOMClient from 'react-dom/client';
import * as sdk from './index';
import * as chart from './chart/index';
import * as ui from './ui';
export * from './index';

export const PERO_APP_SDK_MODULE_ID = '@pero/app-sdk';
export const PERO_APP_SDK_CHART_MODULE_ID = '@pero/app-sdk/chart';
export const PERO_APP_SDK_UI_MODULE_ID = '@pero/app-sdk/ui';
export const PERO_REACT_MODULE_ID = 'react';
export const PERO_REACT_JSX_RUNTIME_MODULE_ID = 'react/jsx-runtime';
export const PERO_REACT_DOM_MODULE_ID = 'react-dom';
export const PERO_REACT_DOM_CLIENT_MODULE_ID = 'react-dom/client';
export const inject: string[] = [];
/** Module catalogs invoke apply after evaluating this entry's registration. */
export function apply(): void {}

type AppModuleTarget = { __pero_modules?: Record<string, unknown> };
const entries: ReadonlyArray<readonly [string, unknown]> = [
  [PERO_REACT_MODULE_ID, React], [PERO_REACT_JSX_RUNTIME_MODULE_ID, JSX],
  [PERO_REACT_DOM_MODULE_ID, ReactDOM], [PERO_REACT_DOM_CLIENT_MODULE_ID, ReactDOMClient],
  [PERO_APP_SDK_MODULE_ID, sdk], [PERO_APP_SDK_CHART_MODULE_ID, chart], [PERO_APP_SDK_UI_MODULE_ID, ui],
];

/** One SDK registry and React runtime, wholly inside this App document. */
export function installPeroAppSdk(target: AppModuleTarget = globalThis as AppModuleTarget): () => void {
  const modules = target.__pero_modules ?? (target.__pero_modules = {});
  const releases: Array<() => void> = [];
  try {
    for (const [id, value] of entries) {
      const previous = modules[id];
      if (previous && previous !== value) throw new Error(`${id} is already registered by another host`);
      modules[id] = value;
      releases.push(() => {
        if (modules[id] !== value) return;
        if (previous) modules[id] = previous; else delete modules[id];
      });
    }
  } catch (error) {
    for (const release of releases.reverse()) release();
    throw error;
  }
  return () => { for (const release of [...releases].reverse()) release(); };
}
installPeroAppSdk();
