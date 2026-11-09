/** Host-owned installed declarations. This catalog grants neither embedding nor execution. */
export interface InstalledAppViews {
  app: string;
  title: string;
  version: string;
  revision: string;
  enabled: boolean;
  panels: { id: string; title: string }[];
  actions: { name: string; description: string }[];
}

/** Uses the same SDK context transport in Electron and Native; no backend is resolved. */
export async function listInstalledAppViews(signal?: AbortSignal): Promise<InstalledAppViews[]> {
  const response = await fetch('/host/sdk', { signal, cache: 'no-store' });
  if (!response.ok) throw new Error('Host App catalog is unavailable. Refresh to retry.');
  const context: unknown = await response.json();
  const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
  if (!object(context) || !Array.isArray(context.appViews)) throw new Error('This Host does not expose installed App views to Notebook.');
  // Validate once at the SDK transport boundary. Do not accept URLs or code from a catalog.
  const identifier = (value: unknown): value is string => typeof value === 'string' && value.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
  const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
  const names = new Set<string>();
  return context.appViews.map((value: unknown) => {
    if (!object(value) || !identifier(value.app) || names.has(value.app) || !text(value.title, 200) || !text(value.version, 64) ||
        typeof value.revision !== 'string' || !/^[a-f0-9]{64}$/.test(value.revision) || typeof value.enabled !== 'boolean' ||
        !Array.isArray(value.panels) || value.panels.length < 1 || value.panels.length > 8 ||
        value.panels.some((panel: unknown) => !object(panel) || !identifier(panel.id) || !text(panel.title, 200)) ||
        !Array.isArray(value.actions) || value.actions.length > 32 ||
        value.actions.some((action: unknown) => !object(action) || !identifier(action.name) || !text(action.description, 1000))) {
      throw new Error('Host returned an invalid installed App catalog.');
    }
    names.add(value.app);
    // Keep only public declaration fields; no relative entries, API paths or credentials.
    return { app: value.app, title: value.title, version: value.version, revision: value.revision, enabled: value.enabled,
      panels: value.panels.map(({ id, title }: InstalledAppViews['panels'][number]) => ({ id, title })),
      actions: value.actions.map(({ name, description }: InstalledAppViews['actions'][number]) => ({ name, description })) };
  });
}
