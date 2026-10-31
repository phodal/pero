import type { Reply } from './connector-types';
export type Locale = 'zh' | 'en';
export type PointBrowserRequest = never;
export type PointBrowserOpener = (url: string) => Promise<void>;

/** The App origin has no preload, filesystem or credential handle. */
export async function connectorRequest(payload: Record<string, unknown>): Promise<Reply> {
  const response = await fetch('/host/connectors', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  if (!response.ok) return { ok: false, code: 'MCP_SERVICE_NOT_INSTALLED' };
  return response.json();
}
