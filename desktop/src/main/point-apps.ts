import { createHash, createHmac } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AppWriteDefinition } from './app-write.ts';

type PointManifest = { name: string; version: string; permissions?: { api?: string[]; storage?: boolean }; backend?: { maxBodyBytes?: number }; contributes: { agentTools?: { name: string; description: string; method: 'POST'|'PUT'|'PATCH'|'DELETE'; route: string; parameters: Record<string, unknown> }[] } };
/** Installed metadata only. The Rust store remains the owner of enable/lifetime. */
export async function readPointApp(root: string): Promise<PointManifest | null> {
  const marker = resolve(root, 'point-build.json');
  if (!existsSync(marker)) return null;
  const receipt = JSON.parse(await readFile(marker, 'utf8'));
  if (receipt.schema !== 'pero.point-app-build.v2') return null;
  return JSON.parse(await readFile(resolve(root, 'point-source/app.json'), 'utf8'));
}
export function pointTarget(app: PointManifest, path: string): string {
  const prefix = `/apps/${app.name}`;
  if (!path.startsWith(prefix + '/api/')) throw new Error('Point App API permission denied');
  const target = path.slice(prefix.length);
  const url = new URL(target, 'http://point.invalid');
  const decoded = decodeURIComponent(url.pathname);
  const full = prefix + decoded;
  if (url.origin !== 'http://point.invalid' || !decoded.startsWith('/api/') || decoded.includes('\\') || decoded.split('/').some(part => part === '.' || part === '..') || !(app.permissions?.api ?? []).some(allowed => full === allowed || full.startsWith(allowed + '/')))
    throw new Error('Point App API permission denied');
  return url.pathname + url.search;
}
export function pointHeaders(secret: string, method: string, target: string, body: Uint8Array = new Uint8Array(), seconds = Math.floor(Date.now() / 1000)): Record<string, string> {
  const digest = createHash('sha256').update(body).digest('hex');
  const signature = createHmac('sha256', secret).update(`${seconds}:${method}:${target}:${digest}`).digest('hex');
  return { 'X-Point-App-Proxy': `${seconds}:${signature}` };
}
export function pointWrites(app: PointManifest, panel: string): AppWriteDefinition[] {
  return (app.contributes.agentTools ?? []).map(tool => ({ app: app.name, panel, version: app.version,
    maxBodyBytes: app.backend?.maxBodyBytes ?? 1048576, name: tool.name, description: tool.description, method: tool.method,
    path: pointTarget(app, tool.route), schema: tool.parameters }));
}

const hopHeaders = new Set(['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade']);
/** Carry domain headers (range, provenance, request IDs) without caller identity. */
export function appProxyHeaders(input: Headers, response = false): Headers {
  const headers = new Headers(input);
  for (const key of [...headers.keys()]) {
    if (hopHeaders.has(key.toLowerCase()) || (response ? ['content-length','content-encoding'].includes(key.toLowerCase()) : ['host','authorization','cookie','x-point-app-proxy','x-pero-app-token','x-point-app-agent','x-point-app-execution','x-point-app-execution-proof','x-point-app-react-host'].includes(key.toLowerCase()))) headers.delete(key);
  }
  return headers;
}
