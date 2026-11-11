import type { NotebookDocument, NotebookNode } from './document.ts';
import { notebookContentRoots } from './workspace.ts';

/** A persisted navigation binding, not an execution authority or installed-App claim. */
export interface AppCanvasBinding { id: string; app: string; panel: string; view?: string; declaration?: string; inputs?: Record<string, unknown>; receipt?: Record<string, unknown> }
export function parseAppCanvasBinding(value: unknown): AppCanvasBinding | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid App binding.');
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some(key => !['app', 'id', 'panel', 'view', 'declaration', 'inputs', 'receipt'].includes(key)) || typeof data.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(data.id) ||
      ![data.app, data.panel].every(part => typeof part === 'string' && part.length <= 128 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(part))) throw new Error('Choose an App name and declared panel identifier.');
  const embedded = ['view', 'declaration', 'inputs'].some(key => Object.hasOwn(data, key));
  if (embedded && (typeof data.view !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.view) || data.view.length > 64 ||
      typeof data.declaration !== 'string' || !/^[a-f0-9]{64}$/.test(data.declaration) || !data.inputs || typeof data.inputs !== 'object' || Array.isArray(data.inputs) || JSON.stringify(data.inputs).length > 16384)) throw new Error('Choose a declared embedded view and bounded inputs.');
  if (data.receipt !== undefined && (!embedded || !data.receipt || typeof data.receipt !== 'object' || Array.isArray(data.receipt) || JSON.stringify(data.receipt).length > 65536)) throw new Error('Invalid retained App receipt.');
  return { id: data.id, app: data.app as string, panel: data.panel as string,
    ...(embedded ? { view: data.view as string, declaration: data.declaration as string, inputs: data.inputs as Record<string, unknown> } : {}),
    ...(data.receipt === undefined ? {} : { receipt: data.receipt as Record<string, unknown> }) };
}
export function appCanvasPath(binding: AppCanvasBinding): string { return `/apps/${binding.app}/${binding.panel}`; }

/** Draft bindings must be saved before a view can ask Host to admit them. Receipts are not inputs. */
export function isSavedCanvasBinding(document: NotebookDocument, blockId: string, binding: AppCanvasBinding): boolean {
  let saved: AppCanvasBinding | null = null;
  const visit = (node: NotebookNode) => {
    if (node.type === 'appCanvas' && node.attrs?.blockId === blockId) saved = node.attrs.binding as AppCanvasBinding | null;
    node.content?.forEach(visit);
  };
  notebookContentRoots(document).forEach(visit);
  const input = (value: AppCanvasBinding | null) => value && [value.id, value.app, value.panel, value.view, value.declaration, value.inputs];
  return saved !== null && JSON.stringify(input(saved)) === JSON.stringify(input(binding));
}

/** Availability is based only on a fresh Host catalog, never on a saved binding or error text. */
export function appCanvasAvailability(binding: AppCanvasBinding | null, catalog: readonly {
  app: string; enabled: boolean; panels: readonly { id: string }[]; revision?: string; canvases?: readonly { id: string }[];
}[] | null): 'unbound' | 'unknown' | 'missing-app' | 'disabled-app' | 'missing-panel' | 'missing-view' | 'changed-declaration' | 'available' {
  if (!binding) return 'unbound';
  if (!catalog) return 'unknown';
  const app = catalog.find(app => app.app === binding.app);
  if (!app) return 'missing-app';
  if (!app.enabled) return 'disabled-app';
  if (!app.panels.some(panel => panel.id === binding.panel)) return 'missing-panel';
  if (binding.view && !app.canvases?.some(view => view.id === binding.view)) return 'missing-view';
  if (binding.view && app.revision !== binding.declaration) return 'changed-declaration';
  return 'available';
}
