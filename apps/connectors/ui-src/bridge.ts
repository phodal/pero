import type { Reply } from './connector-types';
export type Locale = 'zh' | 'en';
export type PointBrowserRequest = never;
export type PointBrowserOpener = (url: string) => Promise<void>;

/** The App origin has no preload, filesystem or credential handle. */
export async function connectorRequest(payload: Record<string, unknown>): Promise<Reply> {
  let response: Response;
  try {
    response = await fetch('/host/connectors', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
  } catch { return { ok: false, code: 'MCP_HOST_UNAVAILABLE' }; }
  const code = response.status === 403 ? 'MCP_HOST_FORBIDDEN'
    : response.status === 404 || response.status === 405 ? 'MCP_HOST_ROUTE_UNAVAILABLE'
    : response.status === 400 || response.status === 413 ? 'MCP_ARGUMENT'
    : response.ok ? 'MCP_HOST_INVALID_RESPONSE' : 'MCP_HOST_UNAVAILABLE';
  let value: Reply;
  try { value = await response.json(); }
  catch { return { ok: false, code }; }
  if (!value || typeof value.ok !== 'boolean') return { ok: false, code };
  return response.ok ? value : { ok: false, code: value.code ?? code };
}
