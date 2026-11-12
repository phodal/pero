export type AppPanelRect = { x: number; y: number; width: number; height: number };
export type AppPanelSlot = { id: string; app: string; panel: string; rect: AppPanelRect | null; release?: boolean };

/** Validate the public slot message once at the shell boundary. No URL or code is accepted. */
export function appPanelSlot(value: unknown): AppPanelSlot {
  const data = value as AppPanelSlot | null;
  const identifier = (part: unknown) => typeof part === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(part) && part.length <= 64;
  if (!data || typeof data.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(data.id) || !identifier(data.app) || !identifier(data.panel) || data.app === 'notebook' ||
      (data.release !== undefined && typeof data.release !== 'boolean') ||
      (data.rect !== null && (!data.rect || ![data.rect.x, data.rect.y, data.rect.width, data.rect.height].every(Number.isFinite) ||
        data.rect.x < 0 || data.rect.y < 0 || data.rect.width < 200 || data.rect.height < 180))) throw new Error('Invalid embedded App panel region');
  return { id: data.id, app: data.app, panel: data.panel, rect: data.rect, ...(data.release ? { release: true } : {}) };
}
