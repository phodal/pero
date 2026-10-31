/** Only the mounted, visible Scientific Viewer may request this fixed handoff. */
export function admitPaperNavigation(context: { name: string; panel: string; visible: boolean; origin: string; expectedOrigin: string }, request: unknown): string | null {
  if (!request || typeof request !== 'object' || Array.isArray(request)) return null;
  const value = request as Record<string, unknown>;
  return context.name === 'scientific-viewer' && context.panel === 'viewer' && context.visible
    && context.origin === context.expectedOrigin && value.type === 'pero:app:navigate' && value.target === 'paper-agent'
    && Object.keys(value).every(key => ['type', 'id', 'target'].includes(key))
    && typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 128 ? value.id : null;
}
