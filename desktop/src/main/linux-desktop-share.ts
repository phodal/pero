import { z } from 'zod';
const pairSchema = z.object({ id: z.string().regex(/^[\w-]{43}$/), owner: z.string().regex(/^[\w-]{43}$/),
  viewer: z.string().regex(/^[\w-]{43}$/) }).strict();

export function relayOrigin(value = process.env.PERO_DESKTOP_RELAY_URL) {
  if (!value) return;
  const url = new URL(value);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1')))
    throw new Error('Configure an HTTPS relay origin.');
  return url.origin;
}

export async function createDesktopPair(viewOnly: boolean, origin: string) {
  const key = process.env.PERO_DESKTOP_RELAY_KEY;
  if (!key || key.length < 32) throw new Error('Configure a desktop relay key first.');
  const response = await fetch(new URL('/api/pair', origin), { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8_000),
    headers: { authorization: `Bearer ${key}`, 'x-pero-desktop-mode': viewOnly ? 'view' : 'control' } });
  if (!response.ok) throw new Error(`The relay refused pairing (HTTP ${response.status}).`);
  const pair = pairSchema.parse(await response.json());
  const invite = new URL('/', origin);
  invite.hash = `${pair.id}.${pair.viewer}`;
  return { origin, id: pair.id, ticket: pair.owner, invite: invite.href };
}
