/** A persisted navigation binding, not an execution authority or installed-App claim. */
export interface AppCanvasBinding { id: string; app: string; panel: string }
export function parseAppCanvasBinding(value: unknown): AppCanvasBinding | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid App binding.');
  const data = value as Record<string, unknown>;
  if (Object.keys(data).sort().join(',') !== 'app,id,panel' || typeof data.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(data.id) ||
      ![data.app, data.panel].every(part => typeof part === 'string' && part.length <= 128 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(part))) throw new Error('Choose an App name and declared panel identifier.');
  return { id: data.id, app: data.app as string, panel: data.panel as string };
}
export function appCanvasPath(binding: AppCanvasBinding): string { return `/apps/${binding.app}/${binding.panel}`; }
